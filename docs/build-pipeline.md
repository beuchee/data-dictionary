# Build pipeline and versioning

Three independent Python scripts. `build.py` does **not** re-resolve; it reads the existing resolved files as they are. Each script's docstring documents its full CLI. `snapshot.py` and `build.py` are command lines over `apps/api/app/services/versioning.py` and `catalog_build.py` (standard library only, loaded by path), the same code the v2 API runs; their output is checked against frozen copies of the v1 scripts (`apps/api/tests/test_versioning_and_build.py`).

- **`resolve.py`** expands `expression.items` against the OMOP vocabulary (descendants via `concept_ancestor`, mapped via `concept_relationship`; resolved = included − excluded) and writes `concept_sets_resolved/{id}.json`. Run it only after editing a set's `expression`, then **commit** the resolved file: CI never runs it. `--vocab` is auto-detected (a `.duckdb` file, or a folder of Athena CSV / Parquet); without it, the `ohdsiVocab` key of `config.local.json` is used.
- **`snapshot.py`** records `(id, version) → HEAD commit SHA` in `concept_sets_versions.json` for any version not yet indexed. Called by `build.py`.
- **`build.py`** calls `snapshot.py`, then bundles the source JSON into `legacy/data.json` + `legacy/data_inline.js` (the v1 SPA payload). Resolved sets of ≤100 concepts are inlined; larger ones go to `legacy/concept_sets_resolved/{id}.json` (lazy-loaded). It also copies `concept_sets_versions.json` into the payload as `conceptSetVersionsIndex`.

Generated and gitignored, never hand-edited: `legacy/data.json`, `legacy/data_inline.js`, `legacy/resolved_concept_ids.json`, `legacy/concept_sets_resolved/`.

Pushing to `main` triggers `.github/workflows/build-and-deploy.yml` (and `.gitlab-ci.yml` on GitLab), which runs `build.py` and deploys `legacy/`. Running `build.py` locally is only for previewing.

## Versioned concept sets in projects

Projects pin each concept set to a `version` (`groups[].conceptSets: [{id, version}]`); the app renders that exact version even after the source is bumped, for reproducibility. History is an **index of commit SHAs** (`concept_sets_versions.json`), not duplicated files.

Two paths serve a past version, because inlining them all would dwarf the payload (one microbiology set is 3.7 MB on its own):

- **Inlined at build time**: `build.py` runs `git show <sha>:concept_sets/{id}.json` for the versions a project pins and embeds them in `conceptSetVersions`. Only definitions of ≤500 expression items; resolved lists are never inlined.
- **Fetched at runtime**: everything else is pulled by the browser from the host's raw endpoint at the indexed SHA (`App.fetchConceptSetVersion(id, version)`, cached). A page reading a pinned version must preload it first (`App.fetchPinnedVersions(project)`).

A version that was never snapshotted is unreachable, not merely absent.

### Bumping a version: two commits

1. Edit the `version` field, commit it.
2. `python3 build.py` (`snapshot.py` stamps the pair at `HEAD`; it refuses files with uncommitted changes).
3. Commit the updated `concept_sets_versions.json`.

`snapshot.py` is idempotent. **Never reuse a published `(id, version)` pair**: if a version is wrong, bump again. (In server mode, v2 does it for you: a direct commit that changes a version is followed by its index commit, and `POST /git/pull` runs the backfill.)

### Catching up on missed versions

The default mode only stamps the version on disk, so versions bumped while nobody snapshotted (typically PRs from the "Propose" button: CI runs `build.py` but never commits the index back) are never indexed. `python3 snapshot.py --backfill` walks the history of every `concept_sets/*.json` (deleted ones included) and records the commit that *introduced* each version. `--dry-run` previews. It is **additive only**: an already-indexed pair keeps its SHA even when the walk finds another one (published SHAs are resolved at runtime); disagreements are reported with `--show-divergences`. Opt-in, never called by `build.py`.

## Forks

`reset.py` wipes team content for a fresh fork; `update_from_upstream.py` pulls upstream code while keeping team content. See [`FORKING.md`](../FORKING.md).
