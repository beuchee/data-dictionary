// Ported from legacy/concept-sets.js (the Add Concepts modal: openAddModal,
// searchAddConcepts, buildAddFilterWhere, renderAddActiveFilters, toggleAddRow,
// showAddConceptDetail, submitAddConcepts; its Custom Concept tab). The search
// runs on the loaded vocabulary (server or browser) through `VocabularySource`.
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ArrowRight, Loader2, MousePointerClick, Plus, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DataTable, type DataTableColumn, type DataTableQuery } from '@/components/ui/data-table'
import { DialogShell } from '@/components/ui/dialog-shell'
import { EmptyState } from '@/components/ui/empty-state'
import { Label } from '@/components/ui/label'
import { MultiSelectFilter } from '@/components/ui/multi-select-filter'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { SearchInput } from '@/components/ui/search-input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ConceptDetailPanel } from '@/features/vocabulary'
import { VocabularyUnavailableError, getVocabularySource, type ConceptSearchPage, type FilterOptions, type OmopConcept, type RelatedConcept } from '@/lib/vocabulary'
import { standardKind } from '../lib/concept-links'
import { addItems, itemFromConcept, NO_FLAGS, type ItemFlags } from '../lib/expression'
import { StandardBadge } from '../components/badges'
import { CustomConceptPanel } from './custom-concept-dialog'
import type { ExpressionItem } from '@data-dictionary/format'

interface AddConceptsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: ExpressionItem[]
  onChange: (items: ExpressionItem[]) => void
}

interface Filters {
  domainIds: string[]
  vocabularyIds: string[]
  conceptClassIds: string[]
  standard: ('S' | 'C' | 'N')[]
  validOnly: boolean
}

const NO_FILTERS: Filters = { domainIds: [], vocabularyIds: [], conceptClassIds: [], standard: [], validOnly: true }
const PAGE_SIZE = 50

type SearchState =
  | { status: 'loading' }
  | { status: 'ready'; page: ConceptSearchPage }
  | { status: 'unavailable' }
  | { status: 'error'; error: string }

/** Non-standard concepts about to be added, with what they map to. */
interface Review {
  concepts: OmopConcept[]
  targets: Record<number, RelatedConcept[]> | null
}

/** "Add concepts": the vocabulary search tab and the custom concept tab. */
export function AddConceptsDialog({ open, onOpenChange, items, onChange }: AddConceptsDialogProps) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'search' | 'custom'>('search')
  return (
    <DialogShell open={open} onOpenChange={onOpenChange} kind="workbench" title={t('expression.add_title')} hideFooter contentClassName="flex min-h-0 flex-1 flex-col">
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'search' | 'custom')} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="w-full">
          <TabsTrigger value="search" className="flex-1">
            {t('expression.tab_search')}
          </TabsTrigger>
          <TabsTrigger value="custom" className="flex-1">
            {t('expression.tab_custom')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="search" className="mt-3 flex min-h-0 flex-1 flex-col">
          <SearchPanel items={items} onChange={onChange} />
        </TabsContent>
        <TabsContent value="custom" className="mt-3 min-h-0 flex-1 overflow-auto">
          <CustomConceptPanel items={items} onChange={onChange} />
        </TabsContent>
      </Tabs>
    </DialogShell>
  )
}

function SearchPanel({ items, onChange }: { items: ExpressionItem[]; onChange: (items: ExpressionItem[]) => void }) {
  const { t } = useTranslation()
  const source = getVocabularySource()
  const [text, setText] = useState('')
  const [term, setTerm] = useState('')
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [page, setPage] = useState(0)
  const [state, setState] = useState<SearchState>({ status: 'loading' })
  const [options, setOptions] = useState<FilterOptions | null>(null)
  const [selected, setSelected] = useState<Map<number, OmopConcept>>(new Map())
  const [focused, setFocused] = useState<number | null>(null)
  const [flags, setFlags] = useState<ItemFlags>(NO_FLAGS)
  const [review, setReview] = useState<Review | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const present = useMemo(() => new Set(items.map((i) => i.concept.conceptId)), [items])

  useEffect(() => {
    const timer = setTimeout(() => {
      setTerm(text.trim())
      setPage(0)
    }, 300)
    return () => clearTimeout(timer)
  }, [text])

  useEffect(() => {
    let cancelled = false
    source
      .getFilterOptions()
      .then((o) => !cancelled && setOptions(o))
      .catch(() => undefined) // The search below reports a missing vocabulary.
    return () => {
      cancelled = true
    }
  }, [source])

  useEffect(() => {
    let cancelled = false
    setState((s) => (s.status === 'ready' ? s : { status: 'loading' }))
    source
      .searchConcepts({ term, ...filters, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
      .then((result) => !cancelled && setState({ status: 'ready', page: result }))
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof VocabularyUnavailableError) setState({ status: 'unavailable' })
        else setState({ status: 'error', error: error instanceof Error ? error.message : String(error) })
      })
    return () => {
      cancelled = true
    }
  }, [source, term, filters, page])

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }))
    setPage(0)
  }

  const toggle = (c: OmopConcept, on?: boolean) => {
    setSelected((prev) => {
      const next = new Map(prev)
      if (on ?? !next.has(c.conceptId)) next.set(c.conceptId, c)
      else next.delete(c.conceptId)
      return next
    })
  }

  const commit = (concepts: OmopConcept[]) => {
    const result = addItems(items, concepts.map((c) => itemFromConcept(c, flags)))
    onChange(result.items)
    setSelected(new Map())
    setReview(null)
    setMessage(
      t('expression.added', { count: result.added }) + (result.skipped ? ` ${t('expression.skipped_present', { count: result.skipped })}` : ''),
    )
  }

  // v1 added anything; v2 first points at non-standard concepts and their `Maps to` targets.
  const startAdd = async () => {
    const concepts = [...selected.values()]
    const nonStandard = concepts.filter((c) => standardKind(c.standardConcept) === 'non_standard' && !present.has(c.conceptId))
    if (!nonStandard.length) return commit(concepts)
    setReview({ concepts: nonStandard, targets: null })
    const targets: Record<number, RelatedConcept[]> = {}
    await Promise.all(
      nonStandard.map(async (c) => {
        try {
          targets[c.conceptId] = (await source.getRelated(c.conceptId)).filter((r) => r.relationshipId === 'Maps to')
        } catch {
          targets[c.conceptId] = []
        }
      }),
    )
    setReview((r) => (r ? { ...r, targets } : r))
  }

  const useTargets = () => {
    if (!review?.targets) return
    const replaced = new Set(review.concepts.map((c) => c.conceptId))
    const kept = [...selected.values()].filter((c) => !replaced.has(c.conceptId))
    const mapped = review.concepts.flatMap((c) => {
      const targets = review.targets?.[c.conceptId] ?? []
      return targets.length ? targets : [c]
    })
    commit([...kept, ...mapped])
  }

  const chips: { key: keyof Filters; value: string; label: string }[] = [
    ...filters.domainIds.map((v) => ({ key: 'domainIds' as const, value: v, label: v })),
    ...filters.vocabularyIds.map((v) => ({ key: 'vocabularyIds' as const, value: v, label: v })),
    ...filters.conceptClassIds.map((v) => ({ key: 'conceptClassIds' as const, value: v, label: v })),
    ...filters.standard.map((v) => ({ key: 'standard' as const, value: v, label: t(`expression.standard_filter.${v}`) })),
  ]
  const removeChip = (key: keyof Filters, value: string) => {
    const current = filters[key]
    if (Array.isArray(current)) setFilter(key, (current as string[]).filter((v) => v !== value) as never)
  }

  const columns: DataTableColumn<OmopConcept>[] = [
    {
      id: 'select',
      header: '',
      accessor: () => '',
      size: 36,
      sortable: false,
      align: 'center',
      cell: (c) => (
        <span onClick={(e) => e.stopPropagation()} className="inline-flex">
          <Checkbox
            checked={present.has(c.conceptId) || selected.has(c.conceptId)}
            disabled={present.has(c.conceptId)}
            aria-label={c.conceptName}
            onCheckedChange={(v) => toggle(c, v === true)}
          />
        </span>
      ),
    },
    { id: 'vocabulary', header: t('concept_sets.concept.vocabulary'), accessor: (c) => c.vocabularyId, size: 100, sortable: false },
    { id: 'conceptId', header: t('concept_sets.concept.id'), accessor: (c) => c.conceptId, size: 95, align: 'right', sortable: false },
    { id: 'name', header: t('concept_sets.concept.name'), accessor: (c) => c.conceptName, size: 260, sortable: false },
    { id: 'code', header: t('concept_sets.concept.code'), accessor: (c) => c.conceptCode, size: 95, sortable: false },
    { id: 'domain', header: t('concept_sets.concept.domain'), accessor: (c) => c.domainId, size: 100, sortable: false, hidden: true },
    { id: 'class', header: t('concept_sets.concept.class'), accessor: (c) => c.conceptClassId, size: 110, sortable: false, hidden: true },
    {
      id: 'standard',
      header: t('concept_sets.concept.standard'),
      accessor: (c) => t(`concept_sets.standard.${standardKind(c.standardConcept)}`),
      size: 110,
      align: 'center',
      sortable: false,
      cell: (c) => <StandardBadge standardConcept={c.standardConcept} />,
    },
  ]

  const onQueryChange = (q: DataTableQuery) => setPage((p) => (p === q.page ? p : q.page))

  if (state.status === 'unavailable') {
    return <NoticeBanner tone="warning" title={t('expression.no_vocabulary_title')} description={t('expression.no_vocabulary_description')} />
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput size="dense" className="w-full max-w-xs" value={text} onChange={setText} placeholder={t('expression.search_placeholder')} />
        <MultiSelectFilter value={filters.domainIds} options={options?.domains ?? []} placeholder={t('concept_sets.concept.domain')} onChange={(v) => setFilter('domainIds', v)} />
        <MultiSelectFilter value={filters.vocabularyIds} options={options?.vocabularies ?? []} placeholder={t('concept_sets.concept.vocabulary')} onChange={(v) => setFilter('vocabularyIds', v)} />
        <MultiSelectFilter value={filters.conceptClassIds} options={options?.conceptClasses ?? []} placeholder={t('concept_sets.concept.class')} onChange={(v) => setFilter('conceptClassIds', v)} />
        <MultiSelectFilter
          value={filters.standard}
          options={(['S', 'C', 'N'] as const).map((v) => ({ value: v, label: t(`expression.standard_filter.${v}`) }))}
          placeholder={t('concept_sets.concept.standard')}
          onChange={(v) => setFilter('standard', v as Filters['standard'])}
        />
        <div className="flex items-center gap-1.5">
          <Checkbox id="add-valid-only" checked={filters.validOnly} onCheckedChange={(v) => setFilter('validOnly', v === true)} />
          <Label htmlFor="add-valid-only">{t('expression.valid_only')}</Label>
        </div>
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {chips.map((c) => (
            <Badge key={`${c.key}:${c.value}`} variant="secondary" className="gap-1">
              {c.label}
              <button type="button" aria-label={t('expression.remove_filter', { value: c.label })} onClick={() => removeChip(c.key, c.value)}>
                <X size={10} />
              </button>
            </Badge>
          ))}
          <Button variant="ghost" size="xs" onClick={() => setFilters({ ...NO_FILTERS, validOnly: filters.validOnly })}>
            {t('expression.clear_filters')}
          </Button>
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[3fr_2fr]">
        <div className="min-h-0 overflow-auto">
          {state.status === 'error' && <NoticeBanner tone="danger" title={t('expression.search_error')} description={state.error} />}
          {state.status === 'loading' && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
          {state.status === 'ready' && (
            <DataTable
              key={`${term}|${JSON.stringify(filters)}`}
              data={state.page.concepts}
              columns={columns}
              rowKey={(c) => c.conceptId}
              onRowClick={(c) => setFocused(c.conceptId)}
              selectedRowKey={focused}
              rowClassName={(c) => (present.has(c.conceptId) ? 'text-muted-foreground' : undefined)}
              cellTooltips="all"
              pageSize={PAGE_SIZE}
              density="compact"
              emptyMessage={t('expression.no_results')}
              server={{ total: state.page.total, onQueryChange }}
            />
          )}
        </div>
        <div className="min-h-[320px] overflow-hidden rounded-md border">
          {focused !== null ? (
            <ConceptDetailPanel conceptId={focused} onNavigate={setFocused} className="h-full" />
          ) : (
            <EmptyState icon={MousePointerClick} title={t('expression.pick_concept')} className="h-full" />
          )}
        </div>
      </div>

      {review && (
        <NoticeBanner
          tone="warning"
          title={t('expression.non_standard_title', { count: review.concepts.length })}
          description={
            <span className="block space-y-1">
              <span className="block">{t('expression.non_standard_description')}</span>
              {review.concepts.map((c) => (
                <span key={c.conceptId} className="flex flex-wrap items-center gap-1 text-xs">
                  <AlertTriangle size={12} className="shrink-0" />
                  {c.conceptName} <span className="font-mono">#{c.conceptId}</span>
                  <ArrowRight size={12} />
                  {review.targets === null ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : review.targets[c.conceptId]?.length ? (
                    review.targets[c.conceptId].map((m) => (
                      <span key={m.conceptId}>
                        {m.conceptName} <span className="font-mono">#{m.conceptId}</span> ({m.vocabularyId})
                      </span>
                    ))
                  ) : (
                    <em>{t('expression.no_maps_to')}</em>
                  )}
                </span>
              ))}
            </span>
          }
          action={
            <span className="flex flex-col gap-1">
              <Button size="xs" onClick={useTargets} disabled={review.targets === null}>
                {t('expression.use_standard')}
              </Button>
              <Button size="xs" variant="outline" onClick={() => commit([...selected.values()])}>
                {t('expression.add_as_is')}
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setReview(null)}>
                {t('common.cancel')}
              </Button>
            </span>
          }
        />
      )}

      <div className="flex flex-wrap items-center gap-3 border-t pt-2">
        {(['isExcluded', 'includeDescendants', 'includeMapped'] as const).map((flag) => (
          <div key={flag} className="flex items-center gap-1.5">
            <Checkbox id={`add-flag-${flag}`} checked={flags[flag]} onCheckedChange={(v) => setFlags((f) => ({ ...f, [flag]: v === true }))} />
            <Label htmlFor={`add-flag-${flag}`}>{t(`expression.flag.${flag}`)}</Label>
          </div>
        ))}
        {message && <span className="text-xs text-muted-foreground">{message}</span>}
        <Button className="ml-auto" onClick={() => void startAdd()} disabled={!selected.size || !!review}>
          <Plus size={14} />
          {t('expression.add_selected', { count: selected.size })}
        </Button>
      </div>
    </div>
  )
}
