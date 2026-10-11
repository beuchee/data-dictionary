import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { ArrowLeft, BookA, ExternalLink, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CopyIconButton } from '@/components/ui/copy-icon-button'
import { DataTable, type DataTableColumn } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getVocabularySource, type OmopConcept, type RelatedConcept } from '@/lib/vocabulary'
import { cn } from '@/lib/utils'
import { athenaUrl } from './format'
import { HierarchyGraph } from './hierarchy-graph'
import { useVocabularyQuery, type VocabularyQueryState } from './use-vocabulary-query'

export interface ConceptDetailPanelProps {
  /** The concept to show. Changing it resets the panel's own navigation. */
  conceptId: number
  /** Called when the user moves to another concept from inside the panel
   *  (a related row, a double-click in the graph); the panel follows anyway. */
  onNavigate?: (conceptId: number) => void
  /** Tab shown first. Default `details`. */
  defaultTab?: ConceptDetailTab
  className?: string
}

export type ConceptDetailTab = 'details' | 'related' | 'hierarchy' | 'synonyms'

const HIERARCHY_LIMIT = 150
const HIERARCHY_MAX = 1000

/**
 * One OMOP concept from the loaded vocabulary (server or browser, through
 * `getVocabularySource()`): details, related concepts, an interactive hierarchy
 * graph and synonyms. Fills its container; give it a height.
 */
export function ConceptDetailPanel({ conceptId, onNavigate, defaultTab = 'details', className }: ConceptDetailPanelProps) {
  const [trail, setTrail] = useState<{ root: number; ids: number[] }>({ root: conceptId, ids: [conceptId] })
  // A new `conceptId` from the parent starts a new trail (state derived during render).
  const ids = trail.root === conceptId ? trail.ids : [conceptId]
  if (trail.root !== conceptId) setTrail({ root: conceptId, ids: [conceptId] })
  const currentId = ids[ids.length - 1]

  const go = (id: number) => {
    if (id === currentId) return
    setTrail({ root: conceptId, ids: [...ids, id] })
    onNavigate?.(id)
  }
  const back = () => {
    if (ids.length < 2) return
    const next = ids.slice(0, -1)
    setTrail({ root: conceptId, ids: next })
    onNavigate?.(next[next.length - 1])
  }

  return (
    <ConceptView
      key={currentId}
      conceptId={currentId}
      originId={ids.length > 1 ? ids[ids.length - 2] : null}
      canGoBack={ids.length > 1}
      onBack={back}
      onNavigate={go}
      defaultTab={defaultTab}
      className={className}
    />
  )
}

interface ConceptViewProps {
  conceptId: number
  originId: number | null
  canGoBack: boolean
  onBack: () => void
  onNavigate: (id: number) => void
  defaultTab: ConceptDetailTab
  className?: string
}

function ConceptView({ conceptId, originId, canGoBack, onBack, onNavigate, defaultTab, className }: ConceptViewProps) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<ConceptDetailTab>(defaultTab)
  const [visited, setVisited] = useState<Set<ConceptDetailTab>>(new Set([defaultTab]))
  const source = getVocabularySource()
  const concept = useVocabularyQuery(`concept:${conceptId}`, () => source.getConcept(conceptId))

  const openTab = (next: string) => {
    const value = next as ConceptDetailTab
    setTab(value)
    setVisited((v) => (v.has(value) ? v : new Set(v).add(value)))
  }

  if (concept.status === 'unavailable') {
    return (
      <EmptyState
        icon={BookA}
        title={t('vocabulary.unavailable_title')}
        description={t('vocabulary.unavailable_description')}
        action={
          <Button asChild variant="outline">
            <Link to="/settings/vocabularies">{t('vocabulary.go_to_settings')}</Link>
          </Button>
        }
        className={className}
      />
    )
  }

  const c = concept.status === 'ready' ? concept.data : null

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex shrink-0 items-start gap-2 border-b px-3 py-2">
        {canGoBack && (
          <Button variant="ghost" size="icon-xs" aria-label={t('vocabulary.back')} onClick={onBack}>
            <ArrowLeft size={12} />
          </Button>
        )}
        <div className="min-w-0 flex-1">
          {concept.status === 'loading' ? (
            <Loader2 size={14} className="animate-spin text-muted-foreground" />
          ) : c ? (
            <>
              <p className="text-sm leading-tight font-medium">{c.conceptName}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-xs text-muted-foreground">#{c.conceptId}</span>
                <Badge variant="outline">{c.vocabularyId}</Badge>
                <StandardBadge value={c.standardConcept} />
                {c.invalidReason && <Badge variant="destructive">{t('vocabulary.invalid', { reason: c.invalidReason })}</Badge>}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {concept.status === 'error' ? t('vocabulary.query_error') : t('vocabulary.concept_not_found', { id: conceptId })}
            </p>
          )}
        </div>
      </div>

      {c && (
        <Tabs value={tab} onValueChange={openTab} className="flex min-h-0 flex-1 flex-col">
          <TabsList variant="line" className="w-full shrink-0 justify-start rounded-none border-b px-3">
            {(['details', 'related', 'hierarchy', 'synonyms'] as const).map((id) => (
              <TabsTrigger key={id} value={id} className="flex-none px-3 text-xs">
                {t(`vocabulary.tab_${id}`)}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="details" className="m-0 min-h-0 flex-1 overflow-auto">
            <ConceptDetails concept={c} />
          </TabsContent>
          <TabsContent value="related" className="m-0 min-h-0 flex-1 overflow-auto p-2">
            {visited.has('related') && <RelatedTab conceptId={conceptId} onNavigate={onNavigate} />}
          </TabsContent>
          <TabsContent value="hierarchy" className="m-0 flex min-h-0 flex-1 flex-col">
            {visited.has('hierarchy') && <HierarchyTab conceptId={conceptId} originId={originId} onNavigate={onNavigate} />}
          </TabsContent>
          <TabsContent value="synonyms" className="m-0 min-h-0 flex-1 overflow-auto">
            {visited.has('synonyms') && <SynonymsTab conceptId={conceptId} />}
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

/** 'S' standard, 'C' classification, else non-standard. */
export function StandardBadge({ value }: { value: OmopConcept['standardConcept'] }) {
  const { t } = useTranslation()
  if (value === 'S') return <Badge>{t('vocabulary.standard')}</Badge>
  if (value === 'C') return <Badge variant="secondary">{t('vocabulary.classification')}</Badge>
  return (
    <Badge variant="outline" className="border-destructive text-destructive">
      {t('vocabulary.non_standard')}
    </Badge>
  )
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b py-1.5 last:border-0">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-xs font-medium">{children}</span>
    </div>
  )
}

function ConceptDetails({ concept: c }: { concept: OmopConcept }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-1 px-4 py-3">
      <DetailRow label={t('vocabulary.concept_id')}>
        <span className="inline-flex items-center gap-1 font-mono">
          {c.conceptId}
          <CopyIconButton text={String(c.conceptId)} />
        </span>
      </DetailRow>
      <DetailRow label={t('vocabulary.concept_name')}>{c.conceptName}</DetailRow>
      <DetailRow label={t('vocabulary.concept_code')}>
        <span className="inline-flex items-center gap-1 font-mono">
          {c.conceptCode}
          <CopyIconButton text={c.conceptCode} />
        </span>
      </DetailRow>
      <DetailRow label={t('vocabulary.col_vocabulary')}>{c.vocabularyId}</DetailRow>
      <DetailRow label={t('vocabulary.domain')}>{c.domainId}</DetailRow>
      <DetailRow label={t('vocabulary.concept_class')}>{c.conceptClassId}</DetailRow>
      <DetailRow label={t('vocabulary.standard_concept')}>
        <StandardBadge value={c.standardConcept} />
      </DetailRow>
      <DetailRow label={t('vocabulary.validity')}>
        {c.invalidReason ? t('vocabulary.invalid', { reason: c.invalidReason }) : t('vocabulary.valid')}
      </DetailRow>
      <DetailRow label={t('vocabulary.valid_dates')}>
        {c.validStartDate ?? '—'} → {c.validEndDate ?? '—'}
      </DetailRow>
      <div className="pt-2">
        <a
          href={athenaUrl(c.conceptId)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <ExternalLink size={11} />
          {t('vocabulary.open_athena')}
        </a>
      </div>
    </div>
  )
}

function Pending<T>({ state, children }: { state: VocabularyQueryState<T>; children: (data: T) => ReactNode }) {
  const { t } = useTranslation()
  if (state.status === 'ready') return <>{children(state.data)}</>
  if (state.status === 'error' || state.status === 'unavailable') {
    return <p className="px-4 py-6 text-center text-xs text-muted-foreground">{t('vocabulary.query_error')}</p>
  }
  return (
    <div className="flex h-20 items-center justify-center">
      <Loader2 size={16} className="animate-spin text-muted-foreground" />
    </div>
  )
}

function RelatedTab({ conceptId, onNavigate }: { conceptId: number; onNavigate: (id: number) => void }) {
  const { t } = useTranslation()
  const state = useVocabularyQuery(`related:${conceptId}`, () => getVocabularySource().getRelated(conceptId))
  const columns: DataTableColumn<RelatedConcept>[] = [
    {
      id: 'relationship',
      header: t('vocabulary.relationship'),
      accessor: (r) => r.relationshipId,
      filter: 'select',
    },
    { id: 'vocabulary', header: t('vocabulary.col_vocabulary'), accessor: (r) => r.vocabularyId, filter: 'select' },
    { id: 'name', header: t('vocabulary.concept_name'), accessor: (r) => r.conceptName, filter: 'text' },
    { id: 'id', header: t('vocabulary.concept_id'), accessor: (r) => r.conceptId, filter: 'text' },
  ]
  return (
    <Pending state={state}>
      {(rows) => (
        <>
          {getVocabularySource().kind === 'wasm' && (
            <p className="mb-2 text-[10px] text-muted-foreground">{t('vocabulary.related_browser_note')}</p>
          )}
          <DataTable
            data={rows}
            columns={columns}
            rowKey={(r) => `${r.relationshipId}-${r.conceptId}`}
            onRowClick={(r) => onNavigate(r.conceptId)}
            emptyMessage={t('vocabulary.no_related')}
            cellTooltips="all"
            density="compact"
            pageSize={50}
          />
        </>
      )}
    </Pending>
  )
}

function HierarchyTab({
  conceptId,
  originId,
  onNavigate,
}: {
  conceptId: number
  originId: number | null
  onNavigate: (id: number) => void
}) {
  const { t } = useTranslation()
  const [limit, setLimit] = useState(HIERARCHY_LIMIT)
  const [fullscreen, setFullscreen] = useState(false)
  const state = useVocabularyQuery(`hierarchy:${conceptId}:${limit}`, () =>
    getVocabularySource().getHierarchy(conceptId, { limit }),
  )
  return (
    <div className={fullscreen ? 'fixed inset-0 z-50 flex flex-col bg-background' : 'flex min-h-0 flex-1 flex-col'}>
      <Pending state={state}>
        {(hierarchy) =>
          !hierarchy || hierarchy.nodes.length < 2 ? (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">{t('vocabulary.no_hierarchy')}</p>
          ) : (
            <>
              {hierarchy.truncated && (
                <NoticeBanner
                  tone="warning"
                  className="m-2"
                  title={t('vocabulary.hierarchy_truncated', { count: hierarchy.nodes.length })}
                  action={
                    limit < HIERARCHY_MAX ? (
                      <Button variant="outline" size="xs" onClick={() => setLimit(HIERARCHY_MAX)}>
                        {t('vocabulary.hierarchy_load_more', { count: HIERARCHY_MAX })}
                      </Button>
                    ) : undefined
                  }
                />
              )}
              <div className="min-h-[320px] flex-1">
                <HierarchyGraph
                  hierarchy={hierarchy}
                  originId={originId}
                  onNavigate={onNavigate}
                  fullscreen={fullscreen}
                  onFullscreenChange={setFullscreen}
                />
              </div>
            </>
          )
        }
      </Pending>
    </div>
  )
}

function SynonymsTab({ conceptId }: { conceptId: number }) {
  const { t } = useTranslation()
  const state = useVocabularyQuery(`synonyms:${conceptId}`, () => getVocabularySource().getSynonyms(conceptId))
  return (
    <Pending state={state}>
      {(synonyms) =>
        synonyms.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">{t('vocabulary.no_synonyms')}</p>
        ) : (
          <ul className="divide-y px-4 py-2">
            {synonyms.map((s, i) => (
              <li key={`${i}-${s.synonymName}`} className="py-1.5">
                <p className="text-xs">{s.synonymName}</p>
                {s.languageName && <p className="text-[10px] text-muted-foreground">{s.languageName}</p>}
              </li>
            ))}
          </ul>
        )
      }
    </Pending>
  )
}
