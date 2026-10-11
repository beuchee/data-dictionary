# Drafts, proposals and commits (contract)

The write path of v2. The backend and the web app are built against this contract; change both sides together. Implementation: `apps/api/app/services/drafts_service.py` (submit), `provenance.py` (stamping), `git_service.py` (git), `forge.py` (PR / MR), `oauth_service.py` (sign-in, forge tokens).

## Server mode

A **draft** is a full replacement of one content file, held in the database (never in the repo) until it is submitted. Submitting deletes it.

| Kind (`kind`) | File | `targetId` |
|---|---|---|
| `concept-set` | `concept_sets/{id}.json` | id, or `null` for a new set (id allocated at submit) |
| `project` | `projects/{id}.json` | id, or `null` for a new project |
| `recommended-units` | `units/recommended_units.json` | `null` |
| `unit-conversions` | `units/unit_conversions.json` | `null` |
| `mapping-recommendations` | `mapping_recommendations/mapping_recommendations.json` | `null` |
| `config` | `config.json`, plus `branding/logo.<ext>` / `branding/favicon.<ext>` from `$assets` | `null` |

A `config` draft may carry branding images under the reserved top-level key `"$assets": {"logo"?: {filename, base64}, "favicon"?: …}` (base64 or a `data:` URL). The API refuses a malformed or unsafe image when the draft is saved (422) and again at submit (422 `invalid_asset`, `unsupported_asset_type`, `asset_too_large`, `unsafe_svg`); at submit the key is removed, the images are written to `branding/` in the same commit, and `branding.<kind>` points at them (docs/data-formats.md § Branding images).

Routes (`/api/v1`, camelCase):

- `GET /drafts` (own drafts, full, newest first), `POST /drafts` `{kind, targetId, baseCommit, content}` → 201, `GET|PUT|DELETE /drafts/{id}` (`PUT` `{content, baseCommit?}`). `baseCommit` = content-repo HEAD the edit started from. Someone else's draft is a 404. Keeping a draft needs the kind's propose permission (below), or `reviews:write` for a concept set.
- `POST /drafts/{id}/submit` `{mode: "proposal" | "commit", message}` → `{mode, commitSha, headSha, targetId, conceptSetId?, indexCommitSha?, branch?, proposalUrl?, proposalError?}`. `message` is optional (default `Update concept set 12: Name v1.1.0`); its first line is the PR / MR title.
  - `proposal`: commit on a new branch `proposal/<username>-<kind>-<id|new>-<short sha>`, built on the freshly fetched remote head, and open a GitHub PR / GitLab MR. Pushed with the user's OAuth forge token when they signed in with that forge, else (or when that push is refused) with the instance's service token (`DD_GIT_TOKEN`), the user then credited with a `Co-authored-by: Name <email>` trailer (`Submitted-by: Name (@username)` when the profile has no email). If the forge refuses to open the PR / MR, the branch stays pushed and `proposalUrl` is the forge's "new PR / MR" page for it, with `proposalError`.
  - `commit`: straight onto the content branch; needs the kind's `:commit` permission (maintainer). The working copy must be on the content branch, clean, and at the remote head, else 409 `pull_required` (or `diverged`, `dirty`, `wrong_branch`); a push the remote rejects is also `pull_required`. The working copy moves only after the push succeeded.
- Permissions: `concept-sets:propose` / `projects:propose` for proposals of those kinds; `reviews:write` may submit a `concept-set` proposal whose only change is appended `metadata.reviews` entries (fields the server stamps are ignored in that comparison), else 403 `reviews_only`; units / mapping-recommendations / config drafts need `units:write`, `mappings:write`, `branding:write` respectively (proposal), and that permission plus `concept-sets:commit` (maintainer) for commit.
- On submit the **server** stamps provenance (one place, same rules as v1): `modifiedBy` (profile name, else username), `modifiedDate`, `metadata.organization.current` (config.json `organization`), `metadata.sourceRepo` (config.json repository URL, placed after `organization`), legacy flat `organization` normalized, root `name`/`description` mirrored from `translations.en`; for new sets `createdBy`, `createdDate`, `createdByTool`, `metadata.createdByDetails` (profile), `uniqueId` / `organization` / `reviewStatus: draft` / `origin: null` when absent (an imported set keeps its `uniqueId`, `organization.created` and `origin`); for projects `modifiedDate`, and `createdBy` / `createdDate` when new. An edit cannot rewrite `id`, `createdBy`, `createdDate`, `metadata.uniqueId`, `metadata.origin`, `metadata.createdByDetails` nor `metadata.organization.created`: they are put back from the repository. Missing keys are inserted at their canonical position. Then it validates with `dictionary_format` and writes with `serialize`; numbers equal to the repository's are written with its lexemes (`1.0`, `0.10`), which a browser cannot keep.
- New ids: `max(id_counters.json counter, highest id + 1)` at the remote head, the counter bumped in the same commit.
- Version index: after a `commit` that changes a concept set's `version`, the server records `(id, version) → commit` in `concept_sets_versions.json` in a second commit, pushed with the first (the two-commit flow, automated). After pulling merged proposals, it runs the additive backfill so merged versions get indexed (one more commit, pushed; dropped if the push fails, retried at the next pull).
- `GET /git/status[?fetch=true]` (any signed-in user) → `{branch, contentBranch, head, remote, remoteHead, ahead, behind, dirty}` (`ahead` / `behind` null before the first fetch); `POST /git/pull` (`concept-sets:commit`) fetches and fast-forwards the content working copy → `{before, head, updated, indexed: [{id, version, commit}], indexCommitSha, indexError?}`.

Errors are `{"detail": {"code", "message", …}}`:

| Status | `code` |
|---|---|
| 403 | `forbidden`, `reviews_only` |
| 404 | `target_not_found` (the edited set / project is gone) |
| 409 | `pull_required`, `diverged`, `dirty`, `wrong_branch`, `base_changed` (the file changed since `baseCommit`), `version_published` (that `(id, version)` is already indexed: bump again), `no_changes`, `no_remote`, `not_a_repo` |
| 422 | `invalid_content` with `errors: [{pointer, message}]` |
| 502 | `auth_failed`, `not_found`, `network`, `unknown` (git or forge) |

## Static mode

No server: edits are stored in IndexedDB, and "Propose" reproduces v1's flow (copy the JSON + open the forge's edit / new-file page). Provenance stamping uses the same pure TS function as the server's rules (`lib/export` `stampIndicateExport` / `normalizeConceptSetMeta`).
