# Code conventions (v2)

How code is written in `apps/web` (and, where it applies, `apps/api`). Adapted from Linkr's `docs/conventions.md` (linkr@1310cf4a4). When in doubt, match the surrounding code: consistency matters more than any single rule. UI rules are in [ui-patterns.md](ui-patterns.md); content-file rules in [data-formats.md](data-formats.md).

## Universal rules

- **i18n**: every user-facing string goes through `t('key')`, with the key in **both** `apps/web/src/locales/en/<namespace>.json` and `fr/<namespace>.json`. One file per namespace (`common`, `nav`, `layout`, `auth`, `concept-sets`, `projects`, `mapping`, `settings`, `dev-tools`, `documentation`), so features edit separate files; a file's content sits under its name as the key prefix, kebab-case turned to snake_case (`concept-sets.json` → `t('concept_sets.title')`). Shared words live in `common`. A new namespace is a new file in both folders, nothing else (`lib/i18n.ts` globs them); `i18n.test.ts` fails when en and fr differ. This covers the UI only; dictionary *content* is multilingual in its own JSON, language-first, with no cross-language fallback.
- **Path alias**: always `@/` for imports from `apps/web/src/` (`@/lib/utils`, `@/stores/app-store`). Never `../../`. `cn()` is at `@/lib/utils`.
- **No new `any`**: type it. If an escape is unavoidable, `as unknown as T` with a one-line why; never `@ts-ignore`.
- **No `console.log`** in committed code; `console.error` / `console.warn` for genuine errors.
- **No secrets in code**: config comes from the environment (`DD_*` for the API, `VITE_*` for the web build) or gitignored local files.

## File naming

| Kind | Convention | Example |
|---|---|---|
| TS / React files | kebab-case | `app-sidebar.tsx`, `theme.ts` |
| React exports | PascalCase | `export function AppSidebar()` |
| Hooks | `use-*.ts` file, `useX` export | `use-mobile.ts` → `useIsMobile` |
| Stores | `*-store.ts`, `useXStore` | `app-store.ts` |
| Tests | next to the file, `*.test.ts` | `theme.test.ts` |
| Python | snake_case | `repo_store.py` |
| API routes | kebab-case URLs | `/concept-sets` |

`app/App.tsx` is the one PascalCase file, kept as the entry-point convention.

Target under ~600 lines per file; above ~800, extract.

## Code copied from Linkr

Files copied from `../linkr` start with `// from linkr@<sha> <path>` (or `// Adapted from …` when changed), so fixes can be carried across. Keep the header when you edit the file; switch it to "Adapted from" if you change behaviour.

## Comments

**Default: none.** Name things well and let the code speak; never restate the line below. Write one only when it carries what the code cannot:

- a **why**: a constraint or decision that looks arbitrary until explained;
- an **invariant** a future edit would silently break;
- a **domain or spec fact** (OMOP, WCAG, a vocabulary rule);
- **opaque code** (a regex, generated SQL, color maths): a one-line summary of what it produces;
- a **contract on exported API** (JSDoc on props, defaults, units);
- a **section banner** in a long file.

Deferred work gets `// TODO(scope): what and why`, greppable. No commented-out code.

## Imports, in this order

1. React and third-party (`react`, `react-router`, `react-i18next`)
2. Icons (`lucide-react`)
3. UI components (`@/components/ui/*`)
4. Lib (`@/lib/*`)
5. Stores (`@/stores/*`)
6. Relative (`./foo`)
7. Type-only imports

## React

- Props: a named `interface FooProps`, destructured in the signature.
- Inside a component: hooks first (translation, store selectors, local state, custom hooks), then effects, then handlers, then `return`.
- Zustand: `create<State>()(…)`, state and actions in one object; persisted stores use the `persist` middleware with a `dd-` prefixed key. localStorage keys are always prefixed `dd-`.
- After every `await`, re-check the guard you relied on before it (the component may have moved on); effects that can re-fire carry a `cancelled` flag.

## Error handling

- Never let a rejection reach the user as a blank screen: log, then render a degraded state. Boot shows an error screen when `config.json` can't be loaded.
- A user-facing failure gets an i18n message, not a swallowed `catch`.
- Never `.catch(() => {})` a write something downstream believes happened.

## Tests

- Vitest, Node environment, `src/**/*.test.ts`. Run from `apps/web`: `npm run test`.
- Test **pure, critical logic**: theme derivation and contrast, resolution, SQL / ATLAS / CSV export, unit conversion, serialization, import parsers, versioning, API client behaviour. **Do not unit-test volatile React components.**
- Change a tested function → update its test in the same change.
- Test the input that breaks it (invalid hex, empty list, adversarial string), not only the one that works, and watch a new test fail once before trusting it.

## Quality gates

All must stay at zero errors, from `apps/web`:

```bash
npm run typecheck   # tsc -b
npm run lint        # eslint: errors block, warnings allowed (React Compiler rules)
npm run test        # vitest run
npm run build       # tsc -b && vite build
```

## Commits

English, `Scope: short imperative description`, optional `(#issue)` suffix.
