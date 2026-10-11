import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ListTree, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { DataTable, type DataTableColumn } from '@/components/ui/data-table'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { SearchInput } from '@/components/ui/search-input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { isServerMode } from '@/lib/api-client'
import { filterResolved } from '@/lib/data/catalog'
import { standardKind } from '../lib/concept-links'
import { StandardBadge } from '../components/badges'
import { useLiveResolution } from './live-resolution'
import type { ConceptInfo } from '../components/concept-detail-sheet'
import type { ExpressionItem, ResolvedConcept } from '@data-dictionary/format'

interface LiveResolvedTableProps {
  conceptSetId: number
  items: readonly ExpressionItem[]
  onSelect: (c: ConceptInfo) => void
}

/** "Unsaved resolution": what the edited expression resolves to, before the repository's list follows. */
export function UnsavedResolutionBadge() {
  const { t } = useTranslation()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" tabIndex={0} className="cursor-default border-amber-500/60 text-amber-700 dark:text-amber-400">
          {t('expression.unsaved_resolution')}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        {isServerMode() ? t('expression.unsaved_resolution_hint_server') : t('expression.unsaved_resolution_hint_static')}
      </TooltipContent>
    </Tooltip>
  )
}

/** The Resolved view of an edited expression, resolved live with the loaded vocabulary. */
export function LiveResolvedTable({ conceptSetId, items, onSelect }: LiveResolvedTableProps) {
  const { t } = useTranslation()
  const entry = useLiveResolution(conceptSetId, items)
  const [search, setSearch] = useState('')
  const concepts = entry?.status === 'ready' ? entry.result.resolvedConcepts : null
  const shown = useMemo(() => (concepts ? filterResolved(concepts, search.trim() || undefined) : []), [concepts, search])

  const columns: DataTableColumn<ResolvedConcept>[] = [
    { id: 'vocabulary', header: t('concept_sets.concept.vocabulary'), accessor: (c) => c.vocabularyId, size: 110, filter: 'select' },
    { id: 'conceptId', header: t('concept_sets.concept.id'), accessor: (c) => c.conceptId, size: 100, align: 'right' },
    { id: 'name', header: t('concept_sets.concept.name'), accessor: (c) => c.conceptName, size: 320 },
    { id: 'code', header: t('concept_sets.concept.code'), accessor: (c) => c.conceptCode, size: 110 },
    { id: 'domain', header: t('concept_sets.concept.domain'), accessor: (c) => c.domainId, size: 110, filter: 'select' },
    { id: 'class', header: t('concept_sets.concept.class'), accessor: (c) => c.conceptClassId, size: 130, filter: 'select' },
    {
      id: 'standard',
      header: t('concept_sets.concept.standard'),
      accessor: (c) => t(`concept_sets.standard.${standardKind(c.standardConcept)}`),
      size: 120,
      align: 'center',
      filter: 'select',
      cell: (c) => <StandardBadge standardConcept={c.standardConcept} />,
    },
  ]

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput size="dense" className="w-full max-w-sm" value={search} onChange={setSearch} placeholder={t('concept_sets.concepts.resolved_search')} />
        <UnsavedResolutionBadge />
        {concepts && <span className="text-[10px] text-muted-foreground">{t('expression.resolved_count', { count: concepts.length })}</span>}
        {entry?.status === 'ready' && entry.result.vocabularyVersion?.release && (
          <span className="text-[10px] text-muted-foreground">
            {t('concept_sets.concepts.vocabulary_release', { release: entry.result.vocabularyVersion.release })}
          </span>
        )}
      </div>
      {entry?.status === 'loading' && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          {t('expression.resolving')}
        </p>
      )}
      {entry?.status === 'unavailable' && (
        <NoticeBanner tone="warning" title={t('expression.resolve_unavailable_title')} description={t('expression.resolve_unavailable_description')} />
      )}
      {entry?.status === 'error' && <NoticeBanner tone="danger" title={t('expression.resolve_error')} description={entry.error} />}
      {concepts && (
        <DataTable
          key={search}
          data={shown}
          columns={columns}
          rowKey={(c) => c.conceptId}
          onRowClick={(c) => onSelect(c)}
          cellTooltips="all"
          pageSize={100}
          emptyMessage={search ? t('concept_sets.concepts.resolved_no_match') : t('concept_sets.concepts.resolved_empty')}
        />
      )}
      {!concepts && entry?.status !== 'loading' && entry?.status !== 'error' && entry?.status !== 'unavailable' && <ListTree size={14} />}
    </div>
  )
}
