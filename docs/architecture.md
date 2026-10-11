# Architecture (v2, as built)

How the v2 app is put together today. Plan and decisions: [planning/v2-plan.md](planning/v2-plan.md). Code style: [conventions.md](conventions.md); UI: [ui-patterns.md](ui-patterns.md); content files: [data-formats.md](data-formats.md).

## Layout

```
apps/web/                  React 19 + Vite + Tailwind v4 + shadcn (copied from Linkr), zustand, i18next
  src/app/                 App.tsx (routes, shell), auth-gate.tsx
  src/features/            login/, setup/, account/ … one folder per feature
  src/pages/               routed pages (placeholders until phase 1)
  src/components/ui|layout shared kit (from Linkr) and the shell
  src/lib/data/            DictionarySource: ApiSource | StaticSource
  src/stores/              zustand: config, auth, catalog, app (preferences)
  src/locales/{en,fr}/     one JSON per i18n namespace
  src/content/docs/        user documentation: index.json + {en,fr}/<section>.md, {{placeholders}} from config.json
apps/api/                  FastAPI + SQLAlchemy async + Alembic (copied from Linkr)
  app/services/content_store.py   reads the content working copy
  app/services/git_service.py     the content repo: clone, status, pull, off-tree commits, push
  app/services/drafts_service.py  submit a draft (proposal / commit); provenance.py, forge.py
  app/services/oauth_service.py   GitHub / GitLab / ORCID sign-in, forge tokens
  app/services/versioning.py      version index (snapshot, backfill); stdlib only, run by snapshot.py
  app/services/catalog_build.py   static payload (data.json…); stdlib only, run by build.py
  app/api/v1/routes/       health, setup, auth, oauth, instance, concept_sets, projects, units,
                           mapping_recommendations, drafts, git
packages/dictionary-format/  JSON Schemas + byte-exact parse/serialize/validate, TS and Python
concept_sets/ projects/ units/ …  the content (unchanged, shared with v1 and Linkr)
legacy/                    v1 SPA; build.py writes the static payload here
```

## Two modes

`isServerMode()` (`lib/api-client.ts`) is `!!VITE_API_URL`, fixed at build time.

| | Server (`npm run dev:all`, Docker) | Static (`npm run dev:client`, `build:client`) |
|---|---|---|
| Content | API, from the content working copy | `data/data.json`, built by `python3 build.py` |
| Past versions | API, `git cat-file` in the content dir | forge raw endpoint (GitHub / GitLab) at the indexed commit |
| Login | local accounts + OAuth (GitHub, GitLab, ORCID); anonymous read per `access.anonymousRead` | none |
| Writes | drafts → proposal (PR / MR) or commit (maintainers) | v1's "Propose" (copy + forge edit page) |

## Data flow

```
content dir ──► ContentStore ──► /api/v1 routes ──► ApiSource ─┐
(DD_CONTENT_DIR)  (catalogue,      (require_read)               ├─► catalog-store ──► pages
                   resolved LRU,                                │   (Resource: data/status/error)
                   git history)                                 │
build.py ──► legacy/data.json ──► vite plugin: data/… ──► StaticSource ─┘
```

- **ContentStore** (`apps/api/app/services/content_store.py`). Root: `DD_CONTENT_DIR`; unset, the repo the API runs from (walk up to `concept_sets/` + `config.json`), else `{DD_DATA_DIR}/content` (Docker; cloned from `DD_CONTENT_REPO_URL` at first start). Parses and validates through `dictionary_format`; a file that fails to parse is skipped, one that fails validation is kept; both are logged (`catalogue.issues`). The catalogue reloads when a fingerprint of the content files' (name, mtime, size) changes, checked at most once a second. Resolved lists (67 MB) are parsed on demand, LRU of 16; their counts come from a byte count. Past versions: `concept_sets_versions.json` → sha → `git cat-file blob <sha>:./concept_sets/{id}.json`, sha and path validated, no shell, cached.
- **Routes** (all `GET`, under `/api/v1`, camelCase, compact JSON written by `core/json_response.py`):
  - `/instance/config` → `{config, server: {appVersion, authProviders, anonymousRead, versionHistory, passwordMinLength}}`, always public
  - `/concept-sets` → `ConceptSetSummary[]`; `/concept-sets/{id}?version=` → the file
  - `/concept-sets/{id}/resolved?version=&search=&offset=&limit=` → `{conceptSetId, version, vocabularyVersion, total, offset, limit, resolvedConcepts}` (`total` after search, before paging; no `limit` = all)
  - `/concept-sets/{id}/versions` → `{id, currentVersion, versions: [{version, commit, isCurrent, date, author, message}]}`, newest first
  - `/projects`, `/projects/{id}` (whole files), `/units/recommended`, `/units/conversions`, `/mapping-recommendations`
  - 404 for unknown ids/versions, 503 when the content dir is unusable.
- **Anonymous read**: `core/deps.py` → `require_read("concept-sets:read")`: open while `config.json` → `access.anonymousRead` is true (default), else a valid token with that permission (401 / 403).
- **DictionarySource** (`apps/web/src/lib/data/`): one interface, `getDictionarySource()` picks the implementation. `catalog.ts` holds the pure twins of the Python summary / search / version-history code; `apps/api/tests/fixtures/catalog-golden.json` is checked by both test suites so the two sources return the same shapes. `forge.ts` builds raw URLs (ported from v1).
- **Stores**: `catalog-store` wraps the source (`loadConceptSets()`, `loadConceptSet(id, version)`, `loadResolved(id, query)`, … each a `Resource` with `idle | loading | ready | error`), sharing in-flight calls and dropping responses that arrive after `reset()`. Components read stores; they never fetch.
- **Static payload**: the vite `instance-config` plugin serves `legacy/data.json` as `data/data.json` and `legacy/concept_sets_resolved/{id}.json` as `data/concept_sets_resolved/{id}.json` in dev, and emits them in a static build (not in a server build). It warns when `legacy/data.json` is missing: run `python3 build.py`. `TODO(v2-cutover)`: move that output out of `legacy/`.

## OMOP vocabulary

Concept search, concept details, hierarchy and live resolution read the OHDSI vocabularies (an ATHENA export), held by the server or by the browser.

| | Server | Static |
|---|---|---|
| Held in | `{DD_DATA_DIR}/vocabulary/library/<table>/vocab-<id>.parquet` (one partition per vocabulary, sorted on its owning id) + `shared.parquet` for domain / concept_class / relationship; `inventory.json` | DuckDB-WASM in the tab, copied to IndexedDB (`dd-vocabulary`) after an import and restored on the next visit |
| Imported from | an upload (`PUT /vocabulary/uploads/{id}/files/{name}`, streamed) or a server folder under `DD_VOCABULARY_IMPORT_ROOTS`, as a background job | a folder picked by the user (`showDirectoryPicker`, `<input webkitdirectory>` fallback) |
| `concept_ancestor` | full closure (`closure` mode) | direct parent-child rows only, walked with recursive CTEs (`edges` mode) |
| `concept_relationship`, `concept_synonym` | full | only the rows of the dictionary's resolved concepts (`data/resolved_concept_ids.json`, from `build.py`), full when that file is missing (v1's rule) |

- **Code**: `apps/api/app/services/vocabulary.py` (library, import, adapted from Linkr's `vocabulary_library.py`), `vocabulary_queries.py` (SQL builders), `resolver.py` (port of `resolve.py`), routes in `routes/vocabulary.py`. Web: `apps/web/src/lib/vocabulary/` (`sql.ts` and `resolver.ts`, twins of the Python ones; `api-source.ts`; `wasm-source.ts` + `wasm/` for DuckDB-WASM, lazy-loaded), UI in `src/features/vocabulary/`.
- **One SQL, two engines**: `sql.ts` and `vocabulary_queries.py` emit byte-identical SQL (user text as `$n` parameters, ids inlined only once checked as safe integers). `apps/api/tests/fixtures/vocab/sql-golden.json` is checked by both suites, and the Python suite runs every golden query on both `concept_ancestor` layouts. The resolver is checked against `resolve-cases.json`, produced by the repo's `resolve.py` on the same tiny ATHENA fixture (`fixtures/vocab/athena/`). After changing a builder or the fixture: `cd apps/api && .venv/bin/python tests/fixtures/vocab/make_expected.py`, review the diff.
- **Routes** (`/api/v1/vocabulary`): readers (`require_read("concept-sets:read")`): `GET /info`, `GET /concepts/search?q=&domain=&vocabulary=&conceptClass=&standard=S|C|N&validOnly=&limit=&offset=`, `GET /filter-options`, `GET /concepts/{id}`, `/concepts/{id}/related`, `/concepts/{id}/hierarchy?maxDepth=&limit=`, `/concepts/{id}/synonyms`, `POST /resolve` (`{conceptSetId?, expression: {items}}` → the `concept_sets_resolved/{id}.json` shape). Admin (`settings:manage`): `GET /status`, `POST /uploads`, `PUT /uploads/{id}/files/{name}`, `DELETE /uploads/{id}`, `POST /inspect`, `POST /import`, `GET /jobs`, `GET /jobs/{id}`, `DELETE /vocabularies/{id}`, `DELETE ""` (all). 503 when no vocabulary is loaded.
- **In a page**: `getVocabularySource()` (`@/lib/vocabulary`) gives the mode's `VocabularySource` (`getInfo`, `searchConcepts`, `getFilterOptions`, `getConcept`, `getRelated`, `getHierarchy`, `getSynonyms`, `resolve`); a method rejects with `VocabularyUnavailableError` when nothing is loaded. For one concept, render `<ConceptDetailPanel conceptId={id} onNavigate={…} />` (`@/features/vocabulary`) in a container with a height: it shows details, related concepts, the hierarchy graph (vis-network, lazy) and synonyms, and its own empty state linking to Settings → Vocabularies.
- **DuckDB-WASM assets**: `apps/web/scripts/postinstall.mjs` copies the bundles and `coi-serviceworker.js` to `apps/web/public/` (gitignored). The dev server sends COOP/COEP; a static build keeps the service worker; a server build drops both.
## Write path and git

Contract (routes, permissions, stamping, errors): [design/drafts-and-proposals.md](design/drafts-and-proposals.md).

- **One working copy** of the content repository (`git_service.ContentRepo`): `DD_CONTENT_DIR`, remote `DD_CONTENT_REPO_URL` (else the copy's `origin`), branch `DD_CONTENT_BRANCH` (else config.json `repository.branch`, else `main`). Cloned in full at startup when the dir holds no repository (history is what serves past versions). Every git process runs with an isolated environment (no user / system gitconfig, no credential helper, no prompt, no redirects, https / ssh only); refs, shas and paths are validated before reaching argv; remotes resolving to internal addresses are refused (SSRF); the token goes into the URL of the one call that needs it, never into `.git/config`, and is scrubbed from errors. One asyncio lock per repository serializes git work, run in a worker thread.
- **Submit** (`drafts_service.submit`): fetch → base = remote head → read the file there → stamp (`provenance.py`) → validate → `serialize` → a commit built off-tree (temporary index, `hash-object`, `commit-tree`) → push (`HEAD` of a `proposal/…` branch, or the content branch) → fast-forward the working copy (commits only) → open the PR / MR (`forge.py`: GitHub `POST /repos/{owner}/{repo}/pulls`, GitLab `POST /projects/{id}/merge_requests`, API host = the repository's, forge from config.json `repository.forge` or the host). A failure before the push leaves nothing behind.
- **Versions**: a direct commit that changes a version gets a second commit indexing it; `POST /git/pull` fast-forwards and runs the additive backfill (`versioning.py`, the same code as `snapshot.py --backfill`).
- **Static payload**: `catalog_build.py` is `build.py`'s implementation (the script loads it by path, standard library only, so CI needs nothing but `python3` and git); `tests/test_versioning_and_build.py` checks both scripts against frozen copies of the v1 scripts (`tests/fixtures/reference_scripts/`).

## OAuth

`GET /auth/oauth/{provider}/start` (`github`, `gitlab`, `orcid`; with the Bearer token of a signed-in user to *link* the identity) → `{authorizationUrl}` (`?redirect=true`: a 302) and an HttpOnly `SameSite=Lax` cookie sealing `{state, PKCE verifier, provider, linkUserId, exp}` (crypto.py, 10 min). The provider calls back `GET /auth/oauth/{provider}/callback`, which checks the cookie against `state`, exchanges the code (PKCE S256), then logs in the identity's account, links it to the signed-in one, or creates an account (`DD_OAUTH_DEFAULT_ROLE`, never admin; never matched by email), and redirects to the web app's `/auth/callback#access_token=…&refresh_token=…&provider=…[&linked=1]` (or `#error=<code>`). The web side reads the fragment, stores the pair like a password login, and clears it from the address bar. Redirect URIs come from `DD_PUBLIC_URL` only: register `{DD_PUBLIC_URL}/api/v1/auth/oauth/{provider}/callback` with each provider. Identities live in `user_identities` (provider, stable subject, username, email, profile). GitHub / GitLab tokens are stored per (user, host) in `git_credentials`, AES-GCM sealed to that pair, GitLab's refresh token too (renewed before a push); ORCID fills `users.orcid` and an empty name. `/instance/config` → `server.authProviders` lists `local` plus the enabled providers.

## Environment (`DD_*`, see `apps/api/.env.example`)

| Variable | Purpose |
|---|---|
| `DD_CONTENT_DIR` | content working copy |
| `DD_CONTENT_REPO_URL`, `DD_CONTENT_BRANCH` | remote to clone / pull / push; branch (default: config.json `repository.branch`, else `main`) |
| `DD_GIT_TOKEN` | service token: private fetch, direct commits, proposals of users without a forge sign-in |
| `DD_GIT_AUTHOR_NAME`, `DD_GIT_AUTHOR_EMAIL` | committer of server commits (author = the user) |
| `DD_PUBLIC_URL` | public base URL of the web app (API under `/api/v1`): OAuth redirect URIs |
| `DD_OAUTH_GITHUB_CLIENT_ID/SECRET` (`_SCOPE`) | GitHub sign-in (default scope `read:user user:email public_repo`; `repo` for a private repo) |
| `DD_OAUTH_GITLAB_CLIENT_ID/SECRET/BASE_URL` (`_SCOPE`) | GitLab sign-in, self-hosted base URL (default scope `read_user api`) |
| `DD_OAUTH_ORCID_CLIENT_ID/SECRET`, `DD_OAUTH_ORCID_SANDBOX` | ORCID sign-in |
| `DD_OAUTH_DEFAULT_ROLE` | role of accounts created by OAuth (default `viewer`) |

## Boot and auth

`main.tsx`: load the instance (`source.getInstance()`: the API in server mode, falling back to `config.json` when it does not answer; `config.json` in static mode) → `applyBranding` → `AppErrorBoundary` → `BrowserRouter` → `AuthGate` → `App`.

`AuthGate` (server mode only): `/setup/status` → server unreachable screen, or first-run `SetupWizard` (admin account), or the app. Without a user, the app is shown when anonymous reading is allowed (`anonymousReadAllowed`: the API's answer, else `config.json`), otherwise `LoginPage`. `/login` (outside the shell) is the header's "Log in". `auth-store` keeps the JWT pair in `localStorage` (`dd-` keys, shared with `api-client`'s refresh-and-retry), revalidates with `/auth/me`, follows other tabs, and resets the catalog when the user changes. The header's `UserMenu` opens the profile (`PATCH /auth/me`) and password dialogs.

## Where to add…

- **an API route**: `apps/api/app/api/v1/routes/<name>.py` (kebab-case URL), include it in `app/main.py`, guard reads with `require_read(...)` and writes with `require_permission(...)`, read content through `get_content_store`, write content only through a draft submit (`drafts_service`), never by editing the working copy. Tests in `apps/api/tests/` (`content_fixtures.build_content_dir` gives a small real content dir; `git_fixtures.make_remote` a bare remote and a working clone of it).
- **content access in the web app**: a method on `DictionarySource` (`lib/data/types.ts`), implemented in both `api-source.ts` and `static-source.ts`, exposed by a store action.
- **a page**: `src/pages/` or `src/features/<feature>/`, lazy route in `app/App.tsx`, nav entry in `components/layout/nav-items.ts`.
- **an i18n namespace**: `src/locales/en/<name>.json` and `fr/<name>.json`; keys read `t('<name_in_snake_case>.key')`.
- **a documentation section**: an entry in `src/content/docs/index.json` (id, lucide icon, en/fr titles) and `src/content/docs/{en,fr}/<id>.md` (one `# title`; instance values as `{{app.name}}`, `{{forge.name}}`, `{{repository.url}}`… listed in `features/documentation/doc-placeholders.ts`; links between sections as `?section=<id>`). `docs-content.test.ts` checks the index against the files.
