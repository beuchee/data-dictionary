# UI patterns (v2, `apps/web`)

Which shared component to reach for, and how it looks. **Read before writing any screen.** Adapted from Linkr's `docs/ui-patterns.md` (linkr@1310cf4a4); the components in `apps/web/src/components/ui/` were copied from there and keep their origin in a header comment.

Code style (naming, imports, comments, tests) is in [conventions.md](conventions.md).

**Before building any UI, in order:**
1. A composed component listed below already does it → use it.
2. A shadcn primitive in `components/ui/` does it → use it. To add one, copy it from the shadcn registry (new-york, Radix), adapt imports, use `var(--color-*)` tokens.
3. Only then build. If it is reusable, put it in `components/ui/` (kebab-case file, PascalCase export) and add a row here.

When a shared component *almost* fits, **extend it** with a prop rather than forking it or dropping the feature from your screen.

## 1. Type scale

Only these sizes in new code:

| Class | For |
|---|---|
| `text-2xl font-bold` | Page title (one per screen, via `PageHeader`); also the `StatCard` figure |
| `text-base` | Dialog / sheet titles: set by the primitive, never typed |
| `text-sm` | Body copy, card titles, list rows |
| `text-xs` | Dense contexts: table cells and headers, labels, buttons, dialog descriptions |
| `text-[10px]` | Micro-chrome: inline filters, counters, pagination |

`text-[11px]`, `text-lg`, `text-xl`, `text-3xl` are not part of the scale.

**The primitives carry the scale.** Write `<Label>`, `<Badge>`, `<DialogTitle>`, `<DialogDescription>` with no size class. `Button` defaults to `sm`; use its sizes (`xs`, `sm-tight`, `sm`, `lg`, `icon-xs`, `icon-sm`…) rather than `className="h-7"`. Icons in buttons: `size={14}` (12 for `xs`). `DropdownMenuContent density="compact"` for menus opened from dense toolbars. Inside a dialog, labels and descriptions render at 13px through the `dialog-form-scale` utility; nothing to do at the call site.

## 2. Colors and theming

- **Theme tokens only**: `bg-background`, `text-foreground`, `text-muted-foreground`, `bg-primary`/`text-primary-foreground`, `bg-accent`, `text-destructive`, `border-border`… Never raw palette classes (`text-blue-600`) for chrome: the instance's brand colors override the tokens, and a hard-coded color won't follow them, nor dark mode.
- Tokens are defined in `src/index.css` (`:root` and `.dark`, OKLCH). Dark mode is the `dark` class on `<html>`, toggled from the header (persisted in `app-store`).
- **Branding**: `config.json` → `branding.colors {primary, secondary, accent}` and optional `branding.darkColors`. At boot `lib/theme.ts` (`applyBranding`) converts them to OKLCH, picks a readable foreground (WCAG ≥ 4.5, white or near-black), derives the dark variant when `darkColors` doesn't give one, and overrides `--primary(-foreground)`, `--secondary(-foreground)`, `--accent(-foreground)`, `--ring`, `--sidebar-primary(-foreground)`, `--sidebar-ring`. A missing color leaves the default token. Note that in shadcn `--accent` is the **hover surface** (menus, ghost buttons): a saturated accent tints every hover.

## 3. Page shells

Every page: `PageContainer` + `PageHeader` (`components/ui/page-header.tsx`). Never hand-roll the `<h1>`.

```tsx
<PageContainer>            {/* width: 3xl | 4xl (default) | 5xl | wide */}
  <PageHeader title={t('…')} description={t('…')} actions={<Button>…</Button>} />
  …
</PageContainer>
```

- Search + filter + sort above a list: `ListPageToolbar`; a standalone search box: `SearchInput` (`size="page"` or `"dense"`). Enter in a dropdown search behaves the same everywhere through `search-enter.ts`.
- Group labels (uppercase): `SectionLabel`, with `as="h3"` when it is a heading. Not for a form `<label>`.
- **Empty**: `EmptyState` (`variant="empty"` for an empty collection, `"filtered"` for a search that matched nothing). Inside a table, the table's own empty row.
- **Loading**: a `Skeleton` shaped like the final layout, or `<Loader2 className="animate-spin" size={14} />`. Never `return null` while loading. Lazy routes fall back to `PageLoading`.
- A band explaining what is wrong with the thing on screen and how to fix it: `NoticeBanner` (`tone="warning" | "danger" | "progress"`).
- A headline figure: `StatCard`.

## 4. Data tables

**`DataTable<T>`** (`components/ui/data-table.tsx`) for every tabular list. Declarative: pass columns, not JSX.

```tsx
const columns: DataTableColumn<Row>[] = [
  { id: 'name', header: t('…'), accessor: (r) => r.name, filter: 'text' },
  { id: 'domain', header: t('…'), accessor: (r) => r.domain, filter: 'select' },
]
<DataTable data={rows} columns={columns} rowKey={(r) => r.id} pageSize={100} />
```

It gives per-column tri-state sort, resize, inline filters (text / number / multi-select), column visibility, pagination, truncation tooltips; opt-in: `reorderable`, multi-selection (`selectedRowKeys`), `viewKey` (remember the view inside a dialog), `pinnedRows`, `filterCell`, `rowClassName`, `cellTooltips` (`all` for values people copy, such as concept ids). **Never hand-roll a `useReactTable`.** Always pass `pageSize` on a table that can run long.

Supporting pieces: `MultiSelectFilter`, `ColumnVisibilityMenu`, `TruncatedText` / `TruncatedHeader` (tooltip only when actually cut), `DebouncedInput` (300 ms), and `table-primitives` (filter input class, sort indicator, resize handle) for the rare bespoke table.

## 5. Dialogs

**`DialogShell`**, not raw `Dialog` parts. Pick a `kind`:

| `kind` | Width | For |
|---|---|---|
| `form` (default) | `sm:max-w-md` | create / edit / rename |
| `settings` | `sm:max-w-lg` | configuration, often tabbed |
| `workbench` | `h-[85vh] sm:max-w-5xl` | pickers, diffs, viewers |

Props: `onConfirm`, `confirmLabel`, `confirmDisabled`, `busy`, `destructive`, `footerExtra`, `hideFooter`, `dirtyTracked`. It confirms on Enter itself: don't wrap it in a `<form>`. Never invent a pixel width.

- Tabs fill the width: `TabsList className="w-full"` + `TabsTrigger className="flex-1"`.
- **Destructive actions always go through an `AlertDialog`**, confirm button `<AlertDialogAction variant="destructive">`.
- The button opening a creation dialog says "New <thing>"; the dialog title says "Create a <thing>".

## 6. Fields and controls

| Component | For |
|---|---|
| `FormField` | Any labelled field: label, hint, control, `htmlFor` wiring. With `RequiredMark`, `FieldError`, `FieldInfo`. |
| `Input` / `Textarea` / `Select` / `Checkbox` / `Switch` | Never a raw `<input>`. |
| `PasswordInput` | Any secret input (reveal toggle). |
| `ColorPickerPopover` | Color selection. |
| `CopyIconButton` + `copyText` (`lib/clipboard`) | Every clipboard write; never `navigator.clipboard` directly (undefined over plain HTTP). |

**Tooltips** are the Radix `Tooltip` (`components/ui/tooltip.tsx`); style it as little as possible. The native `title=` attribute is not a tooltip.

## 7. Shell

`app/App.tsx`: `SidebarProvider` → `AppSidebar` (`components/layout/app-sidebar.tsx`) + `SidebarInset` (`Header` + routed page). Navigation entries live in `components/layout/nav-items.ts`; tabs hidden by `config.tabs` are filtered there and their routes are not registered. The sidebar collapses to icons (Cmd/Ctrl+B).
