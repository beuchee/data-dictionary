<!-- TODO(v2): the import flow and "Propose on {{forge.name}}" are v1 (SPA, localStorage). Rewrite when v2 import and server drafts land; the provenance fields (uniqueId, organization, sourceRepo, origin) stay valid. -->

# Sharing concept sets

Forks are not isolated. A concept set authored in one dictionary — yours, INDICATE’s, or any other fork — can be **imported into another**, so teams reuse each other’s work instead of redefining the same clinical variables. Because every dictionary uses the same JSON format, an import is just a copy of the file plus a little provenance bookkeeping.

## Importing from another dictionary

On the concept sets list, click **Import**. Two modes:

- **From a repository** — paste another dictionary’s repo URL (e.g. `https://github.com/indicate-eu/data-dictionary`). The app loads its published catalog and lists every concept set in a sortable, filterable table. Each row is flagged **New**, **Already imported**, or **Conflict** (you have that set at a different version — importing overwrites your local copy). Tick the ones you want and import.
- **From a single concept set** — paste a raw JSON URL (a GitHub `/blob/` page URL is converted to its raw form automatically) and preview it, or paste the JSON directly and import in one click.

Imported sets land in your local catalog; review them, then [Propose on {{forge.name}}](?section=reviewing) to commit them to your repo.

## How sharing stays traceable

Four metadata fields (under `metadata` in each `concept_sets/<id>.json`) keep a shared set traceable back to its source. You never edit them by hand — the app writes them on create, edit and import:

- **`uniqueId`** — a UUID identifying the concept set’s *lineage*. Generated once at creation and **kept unchanged when the set is imported**, so the same set keeps the same id everywhere it travels. A `uniqueId` is unique within a repo: importing one you already have either skips it (same version) or overwrites your copy (different version) — never a duplicate.
- **`organization`** — split into `created` (the authoring team, immutable) and `current` (who maintains the latest content). On import, `current` becomes *your* organization while `created` stays the original author.
- **`sourceRepo`** — the repo currently maintaining the object, refreshed on every edit. Living inside the JSON, it survives even a manual copy-paste.
- **`origin`** — the provenance of an imported copy, written **once at import** then frozen: `{ uniqueId, repo, version, commit, organization, importedDate }`. The `commit` is the exact source SHA, so you can always fetch back the precise version your copy came from. For sets created in your own dictionary, `origin` is `null`.

> [!NOTE]
> **The fork model, in one line**\
> Importing is a **fork of a single concept set**: same `uniqueId` (shared lineage), your `organization.current`, a frozen `origin` pointing at the source. Two dictionaries can then evolve the same set independently, and `origin` + `uniqueId` make the relationship — and any divergence — explicit.

The id in the file name (`concept_sets/383.json`) is a **local** display id, re-assigned on import to avoid collisions. Cross-dictionary matching is always done on `uniqueId`, never on that number.
