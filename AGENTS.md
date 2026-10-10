# INDICATE Data Dictionary

Governed OHDSI concept sets (plus projects, units, mapping recommendations) stored as JSON in this repo, and the app to browse, edit and review them. What and why: [README.md](README.md).

**Status: v2 in progress** on branch `v2`, a React + FastAPI rewrite modelled on Linkr (`../linkr`). The v1 static SPA lives in `legacy/` and is still the live site until v2 reaches parity. Plan and decisions: [docs/planning/v2-plan.md](docs/planning/v2-plan.md).

## Where to read

- **Data formats and content conventions (read before touching any JSON)** → [docs/data-formats.md](docs/data-formats.md)
- Build pipeline, versioning, snapshots → [docs/build-pipeline.md](docs/build-pipeline.md)
- **Code conventions (read before writing v2 code)** → [docs/conventions.md](docs/conventions.md)
- **UI patterns (read before writing any UI)** → [docs/ui-patterns.md](docs/ui-patterns.md)
- Content format contract (schemas, serializer, TS + Python) → [packages/dictionary-format/README.md](packages/dictionary-format/README.md)
- Backend → [apps/api/README.md](apps/api/README.md)
- v1 SPA (`legacy/`) → [docs/legacy-spa.md](docs/legacy-spa.md)
- v2 plan, decisions, open questions → [docs/planning/v2-plan.md](docs/planning/v2-plan.md)
- Forking the dictionary → [FORKING.md](FORKING.md)

## Commands

```bash
# v2 (apps/web on :3000, apps/api on :8000)
npm install                                # from the repo root (npm workspaces)
npm run dev:all                            # web + api together; dev:web / dev:api / dev:client (static mode)
npm test                                   # TS suites (web + format)
cd apps/api && .venv/bin/python -m pytest  # API tests (setup: see apps/api/README.md)
docker compose -f docker/docker-compose.yml up --build

# Content pipeline
python3 resolve.py --vocab <path>          # resolve concept sets → concept_sets_resolved/ (needs OMOP vocab)
python3 resolve.py --vocab <path> --id 10  # resolve one set after editing its expression
python3 build.py                           # snapshot + build legacy/data.json (no vocab needed)
python3 snapshot.py --backfill --dry-run   # find versions missing from the index
```

Each script's docstring documents its full CLI: read it rather than guessing flags.

## Rules

- **Edit** `concept_sets/`, `projects/`, `concept_sets_resolved/`, `units/`, `mapping_recommendations/`, `config.json`. **Never hand-edit** generated files (`legacy/data*.js(on)`, `legacy/resolved_concept_ids.json`, `legacy/concept_sets_resolved/`), nor `concept_sets_versions.json` (only `snapshot.py`) or `id_counters.json` (only `build.py`).
- **Content files are a shared contract** read by v1, v2 and Linkr: keep their format, field order and byte-level formatting. A new field is optional and additive, and goes into the schemas of `packages/dictionary-format` in the same change.
- **Tests follow the code**: pure, critical logic (format, resolution, exports, conversions, auth, git) gets a test in the same change; no tests of volatile UI.
- **Never reuse a published `(id, version)` pair**; a version bump follows the two-commit flow in [docs/build-pipeline.md](docs/build-pipeline.md).
- **OMOP concept metadata comes from the vocabulary DB**, never typed by hand.
- `reviewStatus` is a snake_case slug (`pending_review`, not "pending review").
- Multilingual content is language-first (`{en: {...}, fr: {...}}`), with no cross-language fallback.
- Never invent references (PMC, DOI, URLs) in descriptions: verify each one or leave it out.
