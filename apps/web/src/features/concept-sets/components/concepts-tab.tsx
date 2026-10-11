import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Layers, ListTree } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DataTable, type DataTableColumn, type DataTableQuery } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { SearchInput } from '@/components/ui/search-input'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { resolvedKey, useCatalogStore } from '@/stores/catalog-store'
import { isValidConcept, standardKind } from '../lib/concept-links'
import { ConceptDetailSheet, type ConceptInfo } from './concept-detail-sheet'
import { StandardBadge, ValidityBadge } from './badges'
import type { ExpressionItem } from '@data-dictionary/format'
import type { ConceptSet, ResolvedConcept, ResolvedPage } from '@/lib/data'

export type ConceptsView = 'resolved' | 'expression'

interface ConceptsTabProps {
  conceptSet: ConceptSet
  /** The version on screen when it is not the current one (resolved lists are per version). */
  version?: string
  view: ConceptsView
  onViewChange: (view: ConceptsView) => void
}

export function ConceptsTab({ conceptSet, version, view, onViewChange }: ConceptsTabProps) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<ConceptInfo | null>(null)

  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-md border p-0.5" role="group" aria-label={t('concept_sets.concepts.view')}>
        {(['resolved', 'expression'] as const).map((v) => (
          <Button
            key={v}
            size="xs"
            variant={view === v ? 'secondary' : 'ghost'}
            aria-pressed={view === v}
            onClick={() => onViewChange(v)}
          >
            {v === 'resolved' ? <ListTree size={12} /> : <Layers size={12} />}
            {t(`concept_sets.concepts.${v}`)}
          </Button>
        ))}
      </div>

      {view === 'expression' ? (
        <ExpressionTable items={conceptSet.expression?.items ?? []} onSelect={setSelected} />
      ) : (
        <ResolvedTable conceptSetId={conceptSet.id} version={version} onSelect={setSelected} />
      )}

      <ConceptDetailSheet concept={selected} onOpenChange={(open) => !open && setSelected(null)} />
    </div>
  )
}

// --- Expression ------------------------------------------------------------

function Flag({ on, label }: { on: boolean; label: string }) {
  return on ? <Check size={14} className="mx-auto text-primary" aria-label={label} /> : null
}

function ExpressionTable({ items, onSelect }: { items: ExpressionItem[]; onSelect: (c: ConceptInfo) => void }) {
  const { t } = useTranslation()
  const standardLabel = (s: string | null | undefined) => t(`concept_sets.standard.${standardKind(s)}`)
  const yes = t('concept_sets.concepts.yes')

  const columns: DataTableColumn<ExpressionItem>[] = [
    { id: 'vocabulary', header: t('concept_sets.concept.vocabulary'), accessor: (i) => i.concept.vocabularyId, filter: 'select', size: 110 },
    { id: 'conceptId', header: t('concept_sets.concept.id'), accessor: (i) => i.concept.conceptId, filter: 'number', size: 100, align: 'right' },
    { id: 'name', header: t('concept_sets.concept.name'), accessor: (i) => i.concept.conceptName, filter: 'text', size: 300 },
    { id: 'code', header: t('concept_sets.concept.code'), accessor: (i) => i.concept.conceptCode, filter: 'text', size: 110 },
    { id: 'domain', header: t('concept_sets.concept.domain'), accessor: (i) => i.concept.domainId, filter: 'select', size: 110 },
    { id: 'class', header: t('concept_sets.concept.class'), accessor: (i) => i.concept.conceptClassId, filter: 'select', size: 130, hidden: true },
    {
      id: 'standard',
      header: t('concept_sets.concept.standard'),
      accessor: (i) => standardLabel(i.concept.standardConcept),
      filter: 'select',
      size: 120,
      align: 'center',
      cell: (i) => <StandardBadge standardConcept={i.concept.standardConcept} />,
    },
    {
      id: 'validity',
      header: t('concept_sets.concept.validity'),
      accessor: (i) => (isValidConcept(i.concept.invalidReason) ? t('concept_sets.concept.valid') : t('concept_sets.concept.invalid')),
      filter: 'select',
      size: 100,
      align: 'center',
      hidden: true,
      cell: (i) => <ValidityBadge valid={isValidConcept(i.concept.invalidReason)} invalidReason={i.concept.invalidReason} />,
    },
    {
      id: 'exclude',
      header: t('concept_sets.concepts.exclude'),
      accessor: (i) => (i.isExcluded ? yes : ''),
      size: 80,
      align: 'center',
      cell: (i) => <Flag on={i.isExcluded} label={yes} />,
    },
    {
      id: 'descendants',
      header: t('concept_sets.concepts.descendants'),
      accessor: (i) => (i.includeDescendants ? yes : ''),
      size: 95,
      align: 'center',
      cell: (i) => <Flag on={i.includeDescendants} label={yes} />,
    },
    {
      id: 'mapped',
      header: t('concept_sets.concepts.mapped'),
      accessor: (i) => (i.includeMapped ? yes : ''),
      size: 80,
      align: 'center',
      cell: (i) => <Flag on={i.includeMapped} label={yes} />,
    },
  ]

  if (!items.length) {
    return <EmptyState icon={Layers} title={t('concept_sets.concepts.expression_empty')} variant="filtered" />
  }
  return (
    <DataTable
      data={items}
      columns={columns}
      rowKey={(i) => `${i.concept.conceptId}:${i.isExcluded ? 'x' : ''}`}
      onRowClick={(i) => onSelect(i.concept as ConceptInfo)}
      rowClassName={(i) => (i.isExcluded ? 'text-muted-foreground line-through decoration-muted-foreground/40' : undefined)}
      cellTooltips="all"
      pageSize={100}
      viewKey="concept-set-expression"
    />
  )
}

// --- Resolved ----------------------------------------------------------------

const RESOLVED_PAGE_SIZE = 100

interface ResolvedTableProps {
  conceptSetId: number
  version?: string
  onSelect: (c: ConceptInfo) => void
}

/** Pages and searches on the source side: a resolved list can hold ~9 000 concepts. */
function ResolvedTable({ conceptSetId, version, onSelect }: ResolvedTableProps) {
  const { t } = useTranslation()
  const [searchText, setSearchText] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState({ page: 0, pageSize: RESOLVED_PAGE_SIZE })
  const loadResolved = useCatalogStore((s) => s.loadResolved)

  useEffect(() => {
    const next = searchText.trim()
    if (next === search) return
    const timer = setTimeout(() => {
      setSearch(next)
      setPage((p) => ({ ...p, page: 0 }))
    }, 300)
    return () => clearTimeout(timer)
  }, [searchText, search])

  const query = useMemo(
    () => ({ version, search: search || undefined, offset: page.page * page.pageSize, limit: page.pageSize }),
    [version, search, page],
  )
  const key = resolvedKey(conceptSetId, query)
  const resource = useCatalogStore((s) => s.resolved[key])

  useEffect(() => {
    void loadResolved(conceptSetId, query)
  }, [loadResolved, conceptSetId, query])

  // Keep the last page on screen while the next one loads, so paging does not flash.
  const [shown, setShown] = useState<{ key: string; data: ResolvedPage | null } | null>(null)
  if (resource?.status === 'ready' && shown?.key !== key) setShown({ key, data: resource.data })
  const current = resource?.status === 'ready' ? resource.data : (shown?.data ?? null)

  const standardLabel = (s: string | null | undefined) => t(`concept_sets.standard.${standardKind(s)}`)
  const columns: DataTableColumn<ResolvedConcept>[] = [
    { id: 'vocabulary', header: t('concept_sets.concept.vocabulary'), accessor: (c) => c.vocabularyId, size: 110, sortable: false },
    { id: 'conceptId', header: t('concept_sets.concept.id'), accessor: (c) => c.conceptId, size: 100, align: 'right', sortable: false },
    { id: 'name', header: t('concept_sets.concept.name'), accessor: (c) => c.conceptName, size: 320, sortable: false },
    { id: 'code', header: t('concept_sets.concept.code'), accessor: (c) => c.conceptCode, size: 110, sortable: false },
    { id: 'domain', header: t('concept_sets.concept.domain'), accessor: (c) => c.domainId, size: 110, sortable: false },
    { id: 'class', header: t('concept_sets.concept.class'), accessor: (c) => c.conceptClassId, size: 130, sortable: false },
    {
      id: 'standard',
      header: t('concept_sets.concept.standard'),
      accessor: (c) => standardLabel(c.standardConcept),
      size: 120,
      align: 'center',
      sortable: false,
      cell: (c) => <StandardBadge standardConcept={c.standardConcept} />,
    },
  ]

  const onQueryChange = (q: DataTableQuery) => {
    setPage((p) => (p.page === q.page && p.pageSize === q.pageSize ? p : { page: q.page, pageSize: q.pageSize }))
  }

  if (resource?.status === 'error') {
    return <NoticeBanner tone="danger" title={t('concept_sets.concepts.resolved_error')} description={resource.error} />
  }
  if (!current && resource?.status !== 'ready') {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </div>
    )
  }
  if (!current) {
    return (
      <EmptyState
        icon={ListTree}
        title={t('concept_sets.concepts.resolved_missing_title')}
        description={t('concept_sets.concepts.resolved_missing_description')}
      />
    )
  }

  const release = current.vocabularyVersion?.release
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          size="dense"
          className="w-full max-w-sm"
          value={searchText}
          onChange={setSearchText}
          placeholder={t('concept_sets.concepts.resolved_search')}
        />
        {release && (
          <span className={cn('text-[10px] text-muted-foreground')}>
            {t('concept_sets.concepts.vocabulary_release', { release })}
          </span>
        )}
      </div>
      {/* Keyed on the search: a new search starts again from the first page. */}
      <DataTable
        key={search}
        data={current.resolvedConcepts}
        columns={columns}
        rowKey={(c) => c.conceptId}
        onRowClick={(c) => onSelect(c)}
        cellTooltips="all"
        pageSize={RESOLVED_PAGE_SIZE}
        emptyMessage={search ? t('concept_sets.concepts.resolved_no_match') : t('concept_sets.concepts.resolved_empty')}
        server={{ total: current.total, onQueryChange, loading: resource?.status === 'loading' }}
      />
    </div>
  )
}
