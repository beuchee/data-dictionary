import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { Library, RotateCcw } from 'lucide-react'
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
import { cn } from '@/lib/utils'
import { useCatalogStore } from '@/stores/catalog-store'
import { REVIEW_STATUSES, type ReviewStatus } from '@data-dictionary/format'
import { StatusBadge } from './components/badges'
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

  useEffect(() => {
    void loadConceptSets()
  }, [loadConceptSets])

  useEffect(() => {
    rememberListSearch(location.search)
  }, [location.search])

  const filters = useMemo(() => parseListFilters(searchParams), [searchParams])
  const allRows = useMemo(() => (resource.data ?? []).map((s) => toRow(s, lang)), [resource.data, lang])
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

  const columns = useConceptSetColumns(allRows, filters, update)

  const loading = resource.status === 'idle' || (resource.status === 'loading' && !resource.data)

  return (
    <PageContainer width="wide">
      <PageHeader title={t('concept_sets.title')} description={t('concept_sets.description')} />

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
            onRowClick={(r) => navigate(`/concept-sets/${r.id}`)}
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
      cell: (r) => <span className="truncate font-medium">{r.name}</span>,
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
