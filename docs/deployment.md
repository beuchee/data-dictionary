# Deployment

How to run the v2 app for real: the server mode (Docker), the static mode (GitHub / GitLab Pages), and the switch from v1 to v2 on `main` (the cutover). Architecture of the two modes: [architecture.md](architecture.md#two-modes). Forking a dictionary: [../FORKING.md](../FORKING.md).

| | Server mode | Static mode |
|---|---|---|
| Runs | `web` (nginx + the built app) and `api` (FastAPI), Docker | static files on any host (Pages) |
| Content | a git working copy of the content repository, read and written by the API | `data/data.json`, built from the repo by `build.py` at deploy time |
| Accounts | local accounts, GitHub / GitLab / ORCID sign-in, roles | none |
| Contributions | drafts → pull / merge request, or direct commit (maintainers) | "Propose" on the forge |
| OMOP vocabulary | imported once on the server, shared | imported by each user into their browser (DuckDB-WASM) |

## Server mode (Docker)

From the repo root:

```bash
export DD_SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(48))")
export DD_CONTENT_REPO_URL=https://github.com/<your-org>/<your-repo>   # default: INDICATE's repo
docker compose -f docker/docker-compose.yml up -d --build
```

Open <http://localhost:3000>: the first-run wizard creates the admin account, then sets the organization, branding and anonymous read access (saved as one commit of `config.json`, which needs push access, see `DD_GIT_TOKEN`).

What runs:

- **web** (`docker/Dockerfile.web`): the app built in server mode (`VITE_API_URL=/`), served by nginx on port 80 (published on `DD_WEB_PORT`, default 3000). nginx proxies `/api/` to the api container (1 h timeouts and 512 MB bodies, for vocabulary uploads) and falls back to `index.html` for client routes. The server build has no DuckDB-WASM bundles, no service worker and no `data/` payload.
- **api** (`docker/Dockerfile.api`): FastAPI on port 8000, published on `127.0.0.1:${DD_API_PORT:-8000}` only (the web container reaches it on the compose network). The entrypoint applies the database migrations (`alembic upgrade head`), then starts uvicorn as an unprivileged user. Everything it keeps lives in the `dd-data` volume, mounted at `/var/lib/data-dictionary`:

  | Path in the volume | What |
  |---|---|
  | `data-dictionary.db` | SQLite database (users, roles, drafts, sealed tokens, mapping imports), unless `DD_DATABASE_URL` is set |
  | `secret.key` | key sealing git and OAuth tokens at rest, generated on first use unless `DD_ENCRYPTION_KEY` is set |
  | `content/` | the content repository working copy (`DD_CONTENT_DIR`) |
  | `vocabulary/` | the imported OMOP vocabularies (Parquet) |

### The content repository

The API serves the dictionary from a git working copy with its full history (past concept set versions are read from git). Two ways to provide it:

- **Clone** (the compose default): with `DD_CONTENT_REPO_URL` set and `DD_CONTENT_DIR` holding no repository, the API clones it on start. https and ssh remotes only; hosts resolving to private, loopback or link-local addresses are refused, so an internal forge is not reachable as a remote. A private repository needs `DD_GIT_TOKEN`.
- **Mount** a working copy from the host: add a volume (`- /srv/data-dictionary:/srv/content`), set `DD_CONTENT_DIR=/srv/content`, and `DD_CONTENT_REPO_URL=` (empty) to use the copy's own `origin`. The entrypoint runs the API as the owner of that directory (git refuses a repository owned by another user, and the API writes to it when it pulls or commits); a root-owned directory is refused by git on Linux.

The server never edits the working copy by hand: a submitted draft becomes a commit built on the remote head and pushed, either to a `proposal/…` branch with a pull / merge request, or (maintainers) to the content branch. Changes merged on the forge reach the server when someone with the commit permission pulls (user menu → Repository → Pull), which also indexes new concept set versions.

### Environment variables

All variables are read by `apps/api/app/config.py`. Template: `apps/api/.env.example`.

| Variable | Default | Meaning |
|---|---|---|
| `DD_SECRET_KEY` | insecure placeholder | Signs the JWTs. Required: the API refuses to start with the default or with fewer than 32 bytes unless `DD_DEBUG=true`. Changing it signs everyone out. |
| `DD_DEBUG` | `false` | Development mode: allows the default secret and a `*` CORS origin. Never in production. |
| `DD_DATA_DIR` | `~/.data-dictionary` (Docker: `/var/lib/data-dictionary`) | Instance state: SQLite database, `secret.key`, vocabularies, and by default the content working copy. |
| `DD_DATABASE_URL` | SQLite file in `DD_DATA_DIR` | SQLAlchemy async URL, e.g. `postgresql+asyncpg://user:pass@db:5432/data_dictionary`. |
| `DD_CONTENT_DIR` | the repo the API runs from (development), else `{DD_DATA_DIR}/content` | Content working copy. |
| `DD_CONTENT_REPO_URL` | the working copy's `origin` (compose: INDICATE's repo) | Remote to clone, pull from and push to (https or ssh). |
| `DD_CONTENT_BRANCH` | `config.json` → `repository.branch`, else `main` | Content branch. |
| `DD_GIT_TOKEN` | none | Service token (GitHub PAT, GitLab project or personal token): private repository, direct commits, proposals of users who did not sign in with the forge. Never logged nor returned. |
| `DD_GIT_AUTHOR_NAME` / `DD_GIT_AUTHOR_EMAIL` | `Data Dictionary` / `data-dictionary@localhost` | Committer of the server's commits (the author is the user). |
| `DD_PUBLIC_URL` | `http://localhost:3000` | Public URL of the web app. OAuth redirect URIs are built from it only. |
| `DD_CORS_ORIGINS` | `http://localhost:3000` | Allowed browser origins, comma-separated. Behind the bundled nginx the app and the API share one origin; set it to `DD_PUBLIC_URL`. |
| `DD_OAUTH_GITHUB_CLIENT_ID` / `_SECRET` | none | GitHub sign-in, enabled when both are set. |
| `DD_OAUTH_GITHUB_SCOPE` | `read:user user:email public_repo` | `repo` instead of `public_repo` for a private content repository. |
| `DD_OAUTH_GITLAB_CLIENT_ID` / `_SECRET` | none | GitLab sign-in. |
| `DD_OAUTH_GITLAB_BASE_URL` | `https://gitlab.com` | Self-hosted GitLab. |
| `DD_OAUTH_GITLAB_SCOPE` | `read_user api` | |
| `DD_OAUTH_ORCID_CLIENT_ID` / `_SECRET` | none | ORCID sign-in (identity only: fills the profile's ORCID iD). |
| `DD_OAUTH_ORCID_SANDBOX` | `false` | Use `sandbox.orcid.org`. |
| `DD_OAUTH_DEFAULT_ROLE` | `viewer` | Role of accounts created by an OAuth sign-in (never admin). |
| `DD_VOCABULARY_IMPORT_ROOTS` | empty | Server folders an admin may import an ATHENA export from, comma-separated absolute paths (mount them into the container). Browser uploads always work. |
| `DD_ENCRYPTION_KEY` | generated into `{DD_DATA_DIR}/secret.key` | urlsafe base64 of 32 bytes, sealing tokens at rest. |
| `DD_ENCRYPTION_OLD_KEYS` | empty | Rotated-out keys, comma-separated, still readable. |
| `DD_PASSWORD_MIN_LENGTH` | `12` | Minimum password length (at least 8). |
| `DD_ACCESS_TOKEN_EXPIRE_MINUTES` | `1440` | Access token lifetime. |
| `DD_REFRESH_TOKEN_EXPIRE_DAYS` | `30` | Refresh token lifetime. |
| `DD_ALGORITHM` | `HS256` | JWT algorithm. |

Read by `docker/docker-compose.yml` only: `DD_WEB_PORT` (3000), `DD_API_PORT` (8000). Build arguments of `Dockerfile.web`: `VITE_API_URL` (truthy = server mode; `/` keeps API calls relative) and `BASE_PATH` (sub-path prefix, see below).

### OAuth applications

Register one application per provider with the redirect URI `{DD_PUBLIC_URL}/api/v1/auth/oauth/{github|gitlab|orcid}/callback`, then set its client id and secret. Step by step: [FORKING.md](../FORKING.md#oauth-sign-in-server-mode).

### Reverse proxy and TLS

Put a TLS-terminating proxy in front of the `web` container and point it at `DD_WEB_PORT`; the `api` port stays on loopback. Then set `DD_PUBLIC_URL` (and `DD_CORS_ORIGINS`) to the public `https://` URL, or OAuth redirects go to localhost. The proxy must accept large bodies and long requests like the bundled nginx does (vocabulary uploads and imports). With nginx:

```nginx
server {
    listen 443 ssl;
    server_name dictionary.example.org;
    # ssl_certificate …; ssl_certificate_key …;
    client_max_body_size 512m;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

Caddy: `dictionary.example.org { reverse_proxy 127.0.0.1:3000 }` (Caddy has no default body limit).

To serve the app under a sub-path, build the web image with `BASE_PATH=/prefix/` and `VITE_API_URL=/prefix/`: assets, router and API calls then carry the prefix, and the outer proxy strips it before reaching the container (the bundled nginx serves from `/`).

### PostgreSQL

SQLite suits a single instance. For PostgreSQL, uncomment the `db` service in `docker/docker-compose.yml`, set `DD_DATABASE_URL=postgresql+asyncpg://…@db:5432/…`, and make `api` depend on `db` being healthy. The api image includes the driver (`asyncpg`); migrations create the schema on first start.

### Backups

- **The `dd-data` volume** (or `DD_DATA_DIR`): the SQLite database and `secret.key` are the state that exists nowhere else. Without `secret.key` (or `DD_ENCRYPTION_KEY`), the stored git and OAuth tokens cannot be read and users must reconnect their forge accounts. Copy them while the api container is stopped (`docker compose … stop api`) for a consistent SQLite file. With PostgreSQL, `pg_dump` the database and back up `secret.key`.
- **The content repository** is on the forge: every server change is a pushed commit or proposal branch. The working copy can be re-cloned (delete `content/` and restart). Back up the forge repository as you would any other.
- **Vocabularies** (`vocabulary/`) can be re-imported from ATHENA; back them up only to save the import time.
- Keep `DD_SECRET_KEY` (and `DD_ENCRYPTION_KEY` if set) in your secrets store.

### Upgrades

```bash
git pull                     # or: python3 update_from_upstream.py, in a fork
docker compose -f docker/docker-compose.yml up -d --build
```

Back up the data volume first. Pending database migrations run when the api container starts (entrypoint, then again at application start, a no-op); there is no manual step. Published images: the `Docker images` workflow (`.github/workflows/docker.yml`) builds both images on every push to `v2` and on pull requests, and pushes them to `ghcr.io/<owner>/<repo>/{web,api}:<version>` when a `v*` tag is pushed. A compose file running those images (no build) will follow the first tag; until then, build from source.

## Static mode (GitHub Pages, GitLab Pages, any static host)

```bash
python3 build.py                         # content → legacy/data.json and resolved lists (needs git history)
npm ci
BASE_PATH=/data-dictionary/ npm run build:client
cp apps/web/dist/index.html apps/web/dist/404.html
```

`apps/web/dist/` is the site: the app, `config.json` and its branding images, `data/` (the catalogue built by `build.py`), the DuckDB-WASM bundles and `coi-serviceworker.js`.

- **`BASE_PATH`** is the path the site is served under: `/<repo>/` for a GitHub project site, `/` for a user or organization site or a custom domain. It prefixes asset URLs, the router basename, the `data/` fetches and the service worker scope.
- **`404.html`** is a copy of `index.html`: Pages has no single-page-app fallback, so a deep link (`/data-dictionary/concept-sets/12`) is answered by `404.html`, which boots the app on that route (with a 404 status).
- **Cross-origin isolation**: DuckDB-WASM needs COOP/COEP headers that Pages cannot send; `coi-serviceworker.js` adds them after a one-time reload. A host that sends them itself works too.
- Past concept set versions are fetched from the forge's raw endpoint (`config.json` → `repository.url`) at the commit `concept_sets_versions.json` indexes, so that repository must be public.

CI, today (no deployment, v1 stays live):

- **GitHub**: `.github/workflows/v2-static.yml` builds the site on every push to `v2` and every pull request and uploads it as the `v2-static-site` artifact. `BASE_PATH` is `/<repo>/`, `/` for a `<owner>.github.io` repository, or the repository variable `BASE_PATH` when set. To preview, download the artifact and serve it under that prefix.
- **GitLab**: the `v2-static` job of `.gitlab-ci.yml` does the same on the `v2` branch and on merge requests; `BASE_PATH` is derived from `CI_PAGES_URL` (`/<project>/` on `<group>.gitlab.io`, `/` on a unique domain).

## Cutover (v1 → v2 on `main`)

v1 (`legacy/`) is the live site until the maintainer decides otherwise. The switch, in order:

1. **Merge `v2` into `main`.** Nothing changes for users yet: `build-and-deploy.yml` (GitHub) and the `pages` job (GitLab) keep publishing `legacy/`.
2. **Move the static payload out of `legacy/`.** `build.py` writes into `legacy/` (`DOCS` in `build.py`), read by `apps/web/vite.config.ts` (`STATIC_PAYLOAD`, `STATIC_RESOLVED_DIR`, `STATIC_RESOLVED_IDS`); also `apps/web/src/lib/data/static-source.ts`, `.gitignore`, [build-pipeline.md](build-pipeline.md) and the `build-catalog` skill. All marked `TODO(v2-cutover)`.
3. **Move the branding images** `legacy/logo.png` and `legacy/favicon.png` to `branding/`, set `config.json` → `branding.logo` / `branding.favicon` to `branding/logo.png` / `branding/favicon.png`, and drop the `legacy/` fallback in `apps/web/vite.config.ts` and `apps/api/app/services/branding_assets.py`, the two `COPY legacy/…` lines of `docker/Dockerfile.web` and its `.dockerignore`, and the `legacy/` entries of `PROTECTED` in `update_from_upstream.py`.
4. **Switch the Pages deployment.** GitHub: in `v2-static.yml`, trigger on `main`, replace `upload-artifact` with `configure-pages` + `upload-pages-artifact`, uncomment the `deploy` job; delete `build-and-deploy.yml`. GitLab: replace the `pages` job with the commented v2 one. The Pages URL does not change (`/data-dictionary/`), so `BASE_PATH` stays.
5. **Old links keep working.** The app rewrites v1 hash URLs at boot (`apps/web/src/app/legacy-hash.ts`): `#/concept-sets?id=12&version=1.0.0&tab=review` → `/concept-sets/12?version=1.0.0&tab=reviews`, projects, mapping (and `#/mapping-recommendations`), settings, dev tools, documentation sections, `?lang=`. Other dictionaries importing from this one read either `data.json` (v1) or `data/data.json` (v2) (`features/concept-sets/lib/cross-repo-import.ts`). Check that Linkr still reads the repository (it reads the content files, which do not change).
6. **Remove `legacy/`**: the folder, its entries in `update_from_upstream.py` and `.gitignore`, [legacy-spa.md](legacy-spa.md) and its pointers in `AGENTS.md`. Move the README screenshots (`legacy/screenshots/`, `legacy/data_dictionary.png`) to a neutral folder first, or replace them with v2 screenshots, and update `README.md`. Rewrite the README badge links from `#/documentation` to `/documentation`.
7. **Finish the user documentation**: the pages of `apps/web/src/content/docs/` still marked `TODO(v2)` describe v1 behaviour.
8. **Server instance** (optional, when INDICATE runs one): DNS + TLS, OAuth applications registered for the public URL, `DD_*` set, first-run wizard; tag `v2.0.0` to publish the images.
