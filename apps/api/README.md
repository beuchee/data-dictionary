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
