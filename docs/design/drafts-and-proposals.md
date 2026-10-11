# Drafts, proposals and commits (contract)

The write path of v2. The backend and the web app are built against this contract; change both sides together.

## Server mode

A **draft** is a full replacement of one content file, held in the database (never in the repo) until it is submitted.

| Kind (`kind`) | File | `targetId` |
|---|---|---|
| `concept-set` | `concept_sets/{id}.json` | id, or `null` for a new set (id allocated at submit) |
| `project` | `projects/{id}.json` | id, or `null` for a new project |
| `recommended-units` | `units/recommended_units.json` | `null` |
| `unit-conversions` | `units/unit_conversions.json` | `null` |
| `mapping-recommendations` | `mapping_recommendations/mapping_recommendations.json` | `null` |
| `config` | `config.json` (+ branding files) | `null` |

Routes (`/api/v1`, camelCase):

- `GET /drafts` (own drafts), `POST /drafts` `{kind, targetId, baseCommit, content}`, `GET|PUT|DELETE /drafts/{id}`. `baseCommit` = content-repo HEAD the edit started from.
- `POST /drafts/{id}/submit` `{mode: "proposal" | "commit", message}` → `{mode, commitSha, branch?, proposalUrl?, conceptSetId?}`.
  - `proposal`: commit on a new branch `proposal/<username>-<kind>-<id|new>-<short>` and open a GitHub PR / GitLab MR. Pushed with the user's OAuth forge token when they signed in with that forge, else with the instance's service token (`DD_GIT_TOKEN`), the user then credited with a `Co-authored-by:` trailer.
  - `commit`: straight onto the content branch; needs the kind's `:commit` permission (maintainer). Conflicts with a moved remote → 409 `pull_required`.
- Permissions: `concept-sets:propose` / `projects:propose` for proposals of those kinds; `reviews:write` may submit a `concept-set` draft whose only change is appended `metadata.reviews` entries; units / mapping-recommendations / config drafts need `units:write`, `mappings:write`, `branding:write` respectively (proposal) and maintainer for commit.
- On submit the **server** stamps provenance (one place, same rules as v1): `modifiedBy`, `modifiedDate`, `metadata.organization.current` (instance organization), `metadata.sourceRepo` (instance repo), root `name`/`description` mirrored from `translations.en`, `createdBy*` for new sets; validates with `dictionary_format`; writes with `serialize`.
- Version index: after a `commit` that changes a concept set's `version`, the server records `(id, version) → commit` in `concept_sets_versions.json` in a second commit (the two-commit flow, automated). After pulling merged proposals, it runs the additive backfill so merged versions get indexed.
- `GET /git/status` → `{branch, head, remote, ahead, behind, dirty}`; `POST /git/pull` (maintainer) fast-forwards the content working copy.

## Static mode

No server: edits are stored in IndexedDB, and "Propose" reproduces v1's flow (copy the JSON + open the forge's edit / new-file page). Provenance stamping uses the same pure TS function as the server's rules (`lib/export` `stampIndicateExport` / `normalizeConceptSetMeta`).
