import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { DataTable, type DataTableColumn } from '@/components/ui/data-table'
import { DialogShell } from '@/components/ui/dialog-shell'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { SectionLabel } from '@/components/ui/section-label'
import { sourcesByTarget, type SourceRef, type StatusFilter } from '@/lib/mapping-import/coverage'
import { resolvedKey, useCatalogStore } from '@/stores/catalog-store'
import type { MappingRow } from '@/lib/mapping-import/types'
import type { ResolvedConcept } from '@data-dictionary/format'

interface CoverageDetailsDialogProps {
  conceptSetId: number
  /** '' = current. */
  version: string
  name: string | null
  rows: readonly MappingRow[]
  statuses: StatusFilter
  onClose: () => void
}

interface DetailRow {
  key: string
  concept: ResolvedConcept
  sources: SourceRef[]
}

function sourceLabel(s: SourceRef): string {
  const code = [s.sourceVocabularyId, s.sourceCode].filter(Boolean).join(':') || (s.sourceConceptId ? String(s.sourceConceptId) : '')
  return [code, s.sourceName].filter(Boolean).join(' — ')
}

/** Which resolved concepts of a set the import maps, and from which source codes (v1's details modal, with sources). */
export function CoverageDetailsDialog({ conceptSetId, version, name, rows, statuses, onClose }: CoverageDetailsDialogProps) {
  const { t } = useTranslation()
  const query = useMemo(() => (version ? { version } : {}), [version])
  const resource = useCatalogStore((s) => s.resolved[resolvedKey(conceptSetId, query)])
  const loadResolved = useCatalogStore((s) => s.loadResolved)

  useEffect(() => {
    loadResolved(conceptSetId, query)
  }, [conceptSetId, query, loadResolved])

  const bySource = useMemo(() => sourcesByTarget(rows, statuses), [rows, statuses])
  const concepts = useMemo(() => resource?.data?.resolvedConcepts ?? [], [resource])
  const { local, other } = useMemo(() => {
    const local: DetailRow[] = []
    const other: DetailRow[] = []
    for (const c of concepts) {
      const sources = bySource.get(c.conceptId)
      ;(sources ? local : other).push({ key: String(c.conceptId), concept: c, sources: sources ?? [] })
    }
    return { local, other }
  }, [concepts, bySource])

  const columns = useMemo<DataTableColumn<DetailRow>[]>(
    () => [
      { id: 'id', header: t('coverage.concept_id'), accessor: (r) => r.concept.conceptId, size: 100 },
      { id: 'name', header: t('coverage.concept_name'), accessor: (r) => r.concept.conceptName, filter: 'text' },
      { id: 'vocabulary', header: t('coverage.vocabulary'), accessor: (r) => r.concept.vocabularyId, filter: 'select', size: 110 },
      { id: 'code', header: t('coverage.code'), accessor: (r) => r.concept.conceptCode, size: 110 },
      {
        id: 'sources',
        header: t('coverage.source_codes'),
        accessor: (r) => r.sources.map(sourceLabel).join(' | '),
        filter: 'text',
      },
    ],
    [t],
  )
  const otherColumns = useMemo(() => columns.filter((c) => c.id !== 'sources'), [columns])

  return (
    <DialogShell
      open
      onOpenChange={(o) => !o && onClose()}
      kind="workbench"
      title={name ?? `#${conceptSetId}`}
      description={t('coverage.details_description', {
        total: concepts.length,
        local: local.length,
        other: other.length,
      })}
    >
      {!resource || resource.status === 'loading' || resource.status === 'idle' ? (
        <div className="flex justify-center py-12">
          <Loader2 size={20} className="animate-spin text-muted-foreground" />
        </div>
      ) : resource.status === 'error' || !resource.data ? (
        <NoticeBanner tone="danger" title={t('coverage.resolved_unavailable')} description={resource.error} />
      ) : (
        <div className="flex flex-col gap-4 pr-1">
          <section>
            <SectionLabel as="h3" className="mb-2">
              {t('coverage.local_concepts', { count: local.length })}
            </SectionLabel>
            <DataTable data={local} columns={columns} rowKey={(r) => r.key} pageSize={50} density="compact" cellTooltips="all" emptyMessage={t('coverage.none_local')} />
          </section>
          <section>
            <SectionLabel as="h3" className="mb-2">
              {t('coverage.other_concepts', { count: other.length })}
            </SectionLabel>
            <DataTable data={other} columns={otherColumns} rowKey={(r) => r.key} pageSize={50} density="compact" emptyMessage={t('coverage.none_other')} />
          </section>
        </div>
      )}
    </DialogShell>
  )
}
