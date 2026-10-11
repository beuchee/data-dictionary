<!-- TODO(v2): describes v1, a fully client-side app keeping every edit in localStorage with a "Data Update Available" merge modal and "Reset local data". v2 (server mode) keeps content on the server with drafts; rewrite this page for v2 and keep only what still applies (IndexedDB vocabulary database, static mode). -->

# Local Data

The {{app.name}} is a **fully client-side application**. All data is stored locally in your browser — nothing is sent to a server.

## How it Works

The application uses two browser storage mechanisms:

- **localStorage** — stores concept sets, projects, mapping recommendations, unit conversions, recommended units, user profile, reviews, and language preferences. All your edits (adding, modifying, or deleting concept sets and projects) are saved here.
- **IndexedDB** — stores the OHDSI vocabulary database, powered by [DuckDB-WASM](https://duckdb.org/docs/api/wasm/overview). This is a full SQL database running entirely in your browser, enabling concept search, hierarchy visualization, and expression resolution without any server.

Your data persists across sessions and browser restarts.

## Data Updates

When the application is deployed on {{forge.name}} Pages, the source data (concept sets, projects, etc.) may be updated by contributors via pull requests.

When you visit the application and new data is available, a modal appears — **Data Update Available** (*The data dictionary has been updated.*), with the list of the *3 concept set(s) changed remotely*:

| ID | Name | Version | Modified |
|--:|---|---|---|
| 207 | Plasma glucose | 1.0.0 → 1.1.0 | 2025-03-10 → 2025-04-01 |
| 341 | Certoparin | 1.0.0 → 1.0.1 | 2025-03-15 → 2025-04-02 |
| 342 | Decision authority documented | — | **New** |

Buttons: **Later**, **Apply Updates**.

- **Apply Updates** — merges the remote updates into your local data. If you have local edits on the same concept sets, the modal highlights conflicts and lets you choose between your local version and the remote version for each one.
- **Later** — dismisses the modal and keeps your current local data unchanged. The prompt will reappear on your next visit.

## Reset Local Data

If you want to discard all local modifications and start fresh with the latest deployed version, open the Settings dropdown (gear icon, top-right of the header) and click **Reset local data**:

The dropdown lists **Dictionary Settings** and **Dev Tools**, then, after a separator, **Reset local data** (in red).

This clears all localStorage data (concept sets, projects, reviews, profile, preferences) and reloads the application with the original data from {{forge.name}} Pages.

> [!WARNING]
> **Warning**\
> Reset local data is irreversible. Make sure to **export** any work you want to keep before resetting. See [Exporting](?section=exporting) and [Reviewing & {{forge.name}}](?section=reviewing).

## OHDSI Vocabulary Database

The vocabulary database stored in IndexedDB is independent from the Reset local data action. To manage it, use the **OHDSI Vocabularies** tab in [Dictionary Settings](?section=dictionary-settings).
