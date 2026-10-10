# v1 SPA (`legacy/`)

The site currently live on GitHub Pages: a vanilla-JS single-page app, no build step, no backend. It is kept until v2 reaches parity (see [planning/v2-plan.md](planning/v2-plan.md)), as the behavioural reference and to generate golden outputs for v2's tests. Fix bugs here only when they affect the live site.

- Hash-routed (`#/concept-sets`, `#/projects?id=1`, `#/mapping`, `#/settings`, `#/dev-tools`, `#/documentation`). `router.js` + `spa-init.js` boot it; all page containers and modals are inline in `index.html`.
- `app.js` exposes `window.App`: shared state and utilities (`escapeHtml`, `getConceptSet`, `standardBadge`, `statusLabelsMap`, i18n dictionary, local CRUD overlay, propose-on-forge flow, versioned fetches).
- Each page is an IIFE exposing `show`/`hide`: `concept-sets.js`, `projects.js`, `mapping.js`, `settings.js`, `general-settings.js`, `dev-tools.js`, `documentation.js` (bilingual docs as HTML strings).
- `duckdb-loader.js` loads Athena files into in-browser DuckDB-WASM, persisted in IndexedDB.
- User edits live in `localStorage` (`indicate_*` keys); "Propose on GitHub" copies the JSON and opens the forge's edit page for a PR.
- Branding from `config.json` is applied in `spa-init.js` (title, logo, favicon, visible tabs).

Read the relevant module before changing behaviour; the files are large (`concept-sets.js` ≈ 7.8k lines).
