# Data Dictionary API

FastAPI backend of the Data Dictionary v2 (architecture adapted from Linkr). Python 3.12, managed with [uv](https://docs.astral.sh/uv/).

```bash
cd apps/api
uv venv --python 3.12 && uv pip install -e ".[dev]"   # install
cp .env.example .env                                  # set DD_DEBUG=true for local dev
npm run dev:api                                       # from the repo root; or: .venv/bin/uvicorn app.main:app --reload
.venv/bin/ruff check . && .venv/bin/python -m pytest -q   # lint + tests
```

Configuration is read from `DD_*` variables (see `.env.example`). Migrations run at startup; after changing a model, add a revision with `.venv/bin/alembic revision --autogenerate -m "..."`.

`packages/dictionary-format/python` is an editable path dependency (`[tool.uv.sources]`): content files are parsed, validated and serialized through it, never with bare `json`.

## Content

The API reads the dictionary content from a working copy of the content repository, `DD_CONTENT_DIR`. Unset, it is the repo the API runs from in development (found by walking up from `apps/api`), else `{DD_DATA_DIR}/content` (Docker). `app/services/content_store.py` loads the catalogue lazily and reloads it when a content file changes; past concept set versions come from git (`concept_sets_versions.json` → commit → `git cat-file`). Read routes (`/api/v1/concept-sets`, `/projects`, `/units/*`, `/mapping-recommendations`) are public while `config.json` → `access.anonymousRead` is true, and need a login with the matching `*:read` permission otherwise (`core/deps.py` → `require_read`). `GET /api/v1/instance/config` is always public. Details: [docs/architecture.md](../../docs/architecture.md).

## Writes, git and OAuth

Content is written only by submitting a draft (`/api/v1/drafts`): the server stamps provenance, validates, commits off-tree on the freshly fetched remote head, and pushes a `proposal/…` branch (+ GitHub PR / GitLab MR) or, for maintainers, the content branch itself. Settings: `DD_CONTENT_REPO_URL` (cloned at first start), `DD_CONTENT_BRANCH`, `DD_GIT_TOKEN`; routes `GET /api/v1/git/status`, `POST /api/v1/git/pull`. Sign-in with GitHub, GitLab or ORCID: `DD_PUBLIC_URL` + `DD_OAUTH_*`. Contract: [docs/design/drafts-and-proposals.md](../../docs/design/drafts-and-proposals.md). Tests use temporary bare repositories and mocked forge / provider APIs (`tests/git_fixtures.py`, httpx `MockTransport`).
