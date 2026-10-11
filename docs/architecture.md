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
apps/api/                  FastAPI + SQLAlchemy async + Alembic (copied from Linkr)
  app/services/content_store.py   reads the content working copy
  app/api/v1/routes/       health, setup, auth, instance, concept_sets, projects, units, mapping_recommendations
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
| Login | local accounts (OAuth later); anonymous read per `access.anonymousRead` | none |

## Data flow

```
content dir ──► ContentStore ──► /api/v1 routes ──► ApiSource ─┐
(DD_CONTENT_DIR)  (catalogue,      (require_read)               ├─► catalog-store ──► pages
                   resolved LRU,                                │   (Resource: data/status/error)
                   git history)                                 │
build.py ──► legacy/data.json ──► vite plugin: data/… ──► StaticSource ─┘
```

- **ContentStore** (`apps/api/app/services/content_store.py`). Root: `DD_CONTENT_DIR`; unset, the repo the API runs from (walk up to `concept_sets/` + `config.json`), else `{DD_DATA_DIR}/content` (Docker, cloning TODO). Parses and validates through `dictionary_format`; a file that fails to parse is skipped, one that fails validation is kept; both are logged (`catalogue.issues`). The catalogue reloads when a fingerprint of the content files' (name, mtime, size) changes, checked at most once a second. Resolved lists (67 MB) are parsed on demand, LRU of 16; their counts come from a byte count. Past versions: `concept_sets_versions.json` → sha → `git cat-file blob <sha>:./concept_sets/{id}.json`, sha and path validated, no shell, cached.
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

## Boot and auth

`main.tsx`: load the instance (`source.getInstance()`: the API in server mode, falling back to `config.json` when it does not answer; `config.json` in static mode) → `applyBranding` → `AppErrorBoundary` → `BrowserRouter` → `AuthGate` → `App`.

`AuthGate` (server mode only): `/setup/status` → server unreachable screen, or first-run `SetupWizard` (admin account), or the app. Without a user, the app is shown when anonymous reading is allowed (`anonymousReadAllowed`: the API's answer, else `config.json`), otherwise `LoginPage`. `/login` (outside the shell) is the header's "Log in". `auth-store` keeps the JWT pair in `localStorage` (`dd-` keys, shared with `api-client`'s refresh-and-retry), revalidates with `/auth/me`, follows other tabs, and resets the catalog when the user changes. The header's `UserMenu` opens the profile (`PATCH /auth/me`) and password dialogs.

## Where to add…

- **an API route**: `apps/api/app/api/v1/routes/<name>.py` (kebab-case URL), include it in `app/main.py`, guard reads with `require_read(...)` and writes with `require_permission(...)`, read content through `get_content_store`, write it through `dictionary_format.serialize`. Tests in `apps/api/tests/` (`content_fixtures.build_content_dir` gives a small real content dir).
- **content access in the web app**: a method on `DictionarySource` (`lib/data/types.ts`), implemented in both `api-source.ts` and `static-source.ts`, exposed by a store action.
- **a page**: `src/pages/` or `src/features/<feature>/`, lazy route in `app/App.tsx`, nav entry in `components/layout/nav-items.ts`.
- **an i18n namespace**: `src/locales/en/<name>.json` and `fr/<name>.json`; keys read `t('<name_in_snake_case>.key')`.
