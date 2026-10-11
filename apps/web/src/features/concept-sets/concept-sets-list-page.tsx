import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { Download, Library, ListChecks, RotateCcw, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTable, type DataTableColumn } from '@/components/ui/data-table'
import { DebouncedInput } from '@/components/ui/debounced-input'
import { EmptyState } from '@/components/ui/empty-state'
import { MultiSelectFilter } from '@/components/ui/multi-select-filter'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { PageContainer, PageHeader } from '@/components/ui/page-header'
import { SearchInput } from '@/components/ui/search-input'
import { Skeleton } from '@/components/ui/skeleton'
import { FILTER_INPUT_CLASS } from '@/components/ui/table-primitives'
import { isServerMode } from '@/lib/api-client'
import { overlayConceptSetSummaries } from '@/lib/drafts/overlay'
import { isNewDraft } from '@/lib/drafts/paths'
import { cn } from '@/lib/utils'
import { useCatalogStore } from '@/stores/catalog-store'
import { useDraftsStore } from '@/stores/drafts-store'
import { ConfirmDialog } from '@/features/drafts/confirm-dialog'
import { REVIEW_STATUSES, type ReviewStatus } from '@data-dictionary/format'
import { StatusBadge } from './components/badges'
import { BulkExportDialog } from './editing/bulk-export-dialog'
import { NewConceptSetButton } from './editing/new-concept-set-button'
import {
  applyListFilters,
  categoryCounts,
  parseListFilters,
  selectedStatuses,
  sortCategories,
  subcategoryOptions,
  toRow,
  writeListFilters,
  type ConceptSetRow,
  type ListFilters,
} from './lib/list-filters'
import { rememberListSearch, useContentLanguage } from './lib/navigation'

export function ConceptSetsListPage() {
  const { t } = useTranslation()
  const lang = useContentLanguage()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const resource = useCatalogStore((s) => s.conceptSets)
  const loadConceptSets = useCatalogStore((s) => s.loadConceptSets)
  const drafts = useDraftsStore((s) => s.drafts)
  const hidden = useDraftsStore((s) => s.hidden['concept-set'])
  const loadDrafts = useDraftsStore((s) => s.load)
  const hide = useDraftsStore((s) => s.hide)
  const discardDraft = useDraftsStore((s) => s.discard)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string | number>>(new Set())
  const [exportOpen, setExportOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  useEffect(() => {
    void loadConceptSets()
    void loadDrafts()
  }, [loadConceptSets, loadDrafts])

  useEffect(() => {
    rememberListSearch(location.search)
  }, [location.search])

  const filters = useMemo(() => parseListFilters(searchParams), [searchParams])
  // This user's drafts over the catalog: edited sets show their draft, new ones are listed, locally deleted ones hidden.
  const overlaid = useMemo(() => overlayConceptSetSummaries(resource.data ?? [], drafts, hidden), [resource.data, drafts, hidden])
  const allRows = useMemo(() => overlaid.items.map((s) => toRow(s, lang)), [overlaid, lang])
  const selectedIds = useMemo(() => new Set([...selected].map(Number)), [selected])
  const rows = useMemo(() => applyListFilters(allRows, filters), [allRows, filters])
  const categories = useMemo(() => categoryCounts(allRows), [allRows])

  const update = (patch: Partial<ListFilters>) => {
    setSearchParams(writeListFilters({ ...filters, ...patch }), { replace: true })
  }

  const toggleCategory = (category: string) => {
    const next = filters.categories.includes(category)
      ? filters.categories.filter((c) => c !== category)
      : [...filters.categories, category]
    update({ categories: sortCategories(next) })
  }

  const columns = useConceptSetColumns(allRows, filters, update, overlaid.draftIds)

  // Static mode, as v1: a repository set is hidden in this browser, a set created here loses its draft.
  const deleteSelected = async () => {
    setDeleteOpen(false)
    for (const id of selectedIds) {
      const draft = drafts.find((d) => d.kind === 'concept-set' && (d.targetId ?? d.content.id) === id)
      try {
        if (draft) await discardDraft(draft.id)
      } catch (e) {
        console.error(`Could not discard the draft of concept set ${id}`, e)
        continue
      }
      if (!draft || !isNewDraft(draft)) hide('concept-set', id)
    }
    setSelected(new Set())
  }

  const loading = resource.status === 'idle' || (resource.status === 'loading' && !resource.data)

  return (
    <PageContainer width="wide">
      <PageHeader
        title={t('concept_sets.title')}
        description={t('concept_sets.description')}
        actions={
          <>
            {selecting && selected.size > 0 && !isServerMode() && (
              <Button variant="outline" onClick={() => setDeleteOpen(true)}>
                <Trash2 size={14} />
                {t('concept_sets.list.delete_selected', { count: selected.size })}
              </Button>
            )}
            <Button
              variant={selecting ? 'secondary' : 'outline'}
              aria-pressed={selecting}
              onClick={() => {
                setSelecting(!selecting)
                setSelected(new Set())
              }}
            >
              <ListChecks size={14} />
              {selecting ? t('concept_sets.list.selecting', { count: selected.size }) : t('concept_sets.list.select')}
            </Button>
            <Button variant="outline" onClick={() => setExportOpen(true)} disabled={!resource.data}>
              <Download size={14} />
              {t('concept_sets.edit.export')}
            </Button>
            {resource.data && <NewConceptSetButton summaries={overlaid.items} />}
          </>
        }
      />
      <BulkExportDialog open={exportOpen} onOpenChange={setExportOpen} summaries={overlaid.items} selected={selectedIds} lang={lang} />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('concept_sets.list.delete_title', { count: selected.size })}
        description={t('concept_sets.list.delete_description')}
        confirmLabel={t('concept_sets.edit.delete')}
        onConfirm={() => void deleteSelected()}
      />

      {resource.status === 'error' && (
        <NoticeBanner
          tone="danger"
          className="mt-4"
          title={t('concept_sets.list.load_error')}
          description={resource.error}
          action={
            <Button variant="outline" size="xs" onClick={() => void loadConceptSets(true)}>
              <RotateCcw size={12} />
              {t('concept_sets.retry')}
            </Button>
          }
        />
      )}

      {categories.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-1.5" role="group" aria-label={t('concept_sets.columns.category')}>
          {categories.map(({ category, count }) => {
            const active = filters.categories.includes(category)
            return (
              <button
                key={category}
                type="button"
                aria-pressed={active}
                onClick={() => toggleCategory(category)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-foreground hover:bg-accent',
                )}
              >
                {category}
                <span className={cn('text-[10px]', active ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      )}

      <SearchInput
        className="mt-4"
        value={filters.q}
        onChange={(q) => update({ q })}
        placeholder={t('concept_sets.list.search_placeholder')}
      />

      <div className="mt-4">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        ) : resource.data && resource.data.length === 0 ? (
          <EmptyState icon={Library} title={t('concept_sets.list.empty_title')} description={t('concept_sets.list.empty_description')} />
        ) : resource.data ? (
          <DataTable
            data={rows}
            columns={columns}
            rowKey={(r) => r.id}
            onRowClick={selecting ? undefined : (r) => navigate(`/concept-sets/${r.id}`)}
            selectedRowKeys={selecting ? selected : undefined}
            onSelectedRowKeysChange={selecting ? setSelected : undefined}
            emptyMessage={t('concept_sets.list.no_match')}
            pageSize={50}
            viewKey="concept-sets-list"
          />
        ) : null}
      </div>
    </PageContainer>
  )
}

function useConceptSetColumns(
  allRows: ConceptSetRow[],
  filters: ListFilters,
  update: (patch: Partial<ListFilters>) => void,
  draftIds: ReadonlySet<number>,
): DataTableColumn<ConceptSetRow>[] {
  const { t } = useTranslation()

  const categoryOptions = sortCategories(new Set(allRows.map((r) => r.category).filter(Boolean)))
  const subcategories = subcategoryOptions(allRows, filters.categories)
  const organizations = [...new Set(allRows.map((r) => r.organization).filter(Boolean))].sort()
  const statusOptions = REVIEW_STATUSES.map((s) => ({ value: s, label: t(`concept_sets.status.${s}`) }))

  const multi = (
    header: string,
    value: string[],
    options: string[] | { value: string; label: string }[],
    onChange: (next: string[]) => void,
  ) => () => <MultiSelectFilter value={value} options={options} placeholder={header} onChange={onChange} />

  return [
    {
      id: 'id',
      header: t('concept_sets.columns.id'),
      accessor: (r) => r.id,
      size: 60,
      align: 'right',
      hidden: true,
    },
    {
      id: 'category',
      header: t('concept_sets.columns.category'),
      accessor: (r) => r.category,
      size: 150,
      filterCell: multi(t('concept_sets.columns.category'), filters.categories, categoryOptions, (categories) =>
        update({ categories }),
      ),
    },
    {
      id: 'subcategory',
      header: t('concept_sets.columns.subcategory'),
      accessor: (r) => r.subcategory,
      size: 150,
      filterCell: multi(
        t('concept_sets.columns.subcategory'),
        filters.subcategories.filter((s) => subcategories.includes(s)),
        subcategories,
        (next) => update({ subcategories: next }),
      ),
    },
    {
      id: 'name',
      header: t('concept_sets.columns.name'),
      accessor: (r) => r.name,
      size: 260,
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium">{r.name}</span>
          {draftIds.has(r.id) && (
            <Badge variant="outline" size="xs" className="shrink-0 border-primary/50 text-primary">
              {isServerMode() ? t('drafts.badge_server') : t('drafts.badge')}
            </Badge>
          )}
        </span>
      ),
      tooltip: 'font-medium',
    },
    {
      id: 'shortDescription',
      header: t('concept_sets.columns.description'),
      accessor: (r) => r.shortDescription,
      size: 340,
      filterCell: () => (
        <DebouncedInput
          className={FILTER_INPUT_CLASS}
          placeholder="..."
          value={filters.description}
          onChange={(description) => update({ description })}
        />
      ),
    },
    {
      id: 'version',
      header: t('concept_sets.columns.version'),
      accessor: (r) => r.version,
      size: 80,
      align: 'center',
    },
    {
      id: 'reviewStatus',
      header: t('concept_sets.columns.status'),
      accessor: (r) => r.reviewStatus,
      size: 130,
      align: 'center',
      cell: (r) => <StatusBadge status={r.reviewStatus} />,
      filterCell: multi(t('concept_sets.columns.status'), selectedStatuses(filters), statusOptions, (next) =>
        update({ statuses: next as ReviewStatus[] }),
      ),
    },
    {
      id: 'itemCount',
      header: t('concept_sets.columns.items'),
      accessor: (r) => r.itemCount,
      size: 80,
      align: 'right',
      hidden: true,
    },
    {
      id: 'resolvedCount',
      header: t('concept_sets.columns.resolved'),
      accessor: (r) => r.resolvedCount,
      size: 90,
      align: 'right',
      hidden: true,
    },
    {
      id: 'organization',
      header: t('concept_sets.columns.organization'),
      accessor: (r) => r.organization,
      size: 160,
      hidden: true,
      filterCell: multi(t('concept_sets.columns.organization'), filters.organizations, organizations, (next) =>
        update({ organizations: next }),
      ),
    },
    {
      id: 'modifiedDate',
      header: t('concept_sets.columns.modified'),
      accessor: (r) => r.modifiedDate,
      size: 110,
      hidden: true,
    },
  ]
}
