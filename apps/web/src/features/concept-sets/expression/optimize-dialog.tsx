// Ported from legacy/concept-sets.js (optimizeExpression, doOptimizeExpression: the
// modal listing the changes, the resolved-set check and its diff).
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Loader2, MinusCircle, PlusCircle } from 'lucide-react'
import { DataTable, type DataTableColumn } from '@/components/ui/data-table'
import { DialogShell } from '@/components/ui/dialog-shell'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { VocabularyUnavailableError, getVocabularySource } from '@/lib/vocabulary'
import { optimizeExpression, type OptimizeChange, type OptimizeResult } from '../lib/optimize'
import type { ExpressionItem } from '@data-dictionary/format'

interface OptimizeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  conceptSetId: number
  items: ExpressionItem[]
  onApply: (items: ExpressionItem[]) => void
}

type State =
  | { status: 'running' }
  | { status: 'unavailable' }
  | { status: 'error'; error: string }
  | { status: 'done'; result: OptimizeResult; names: Map<number, string> }

/**
 * "Optimize expression": drops items an ancestor with descendants already
 * covers, then tries one parent that replaces several items; shows the
 * changes and whether the resolved concepts stay the same before applying.
 */
export function OptimizeDialog({ open, onOpenChange, items, onApply }: OptimizeDialogProps) {
  const { t } = useTranslation()
  const [state, setState] = useState<State>({ status: 'running' })

  useEffect(() => {
    let cancelled = false
    const source = getVocabularySource()
    const run = async () => {
      try {
        const result = await optimizeExpression(source, items)
        const diff = [...result.gained, ...result.lost]
        const names = new Map<number, string>()
        if (diff.length) for (const c of await source.getConcepts(diff.slice(0, 500))) names.set(c.conceptId, c.conceptName)
        if (!cancelled) setState({ status: 'done', result, names })
      } catch (error) {
        if (cancelled) return
        if (error instanceof VocabularyUnavailableError) setState({ status: 'unavailable' })
        else setState({ status: 'error', error: error instanceof Error ? error.message : String(error) })
      }
    }
    void run()
    return () => {
      cancelled = true
    }
    // Runs once per opening, on the expression as it was then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const flags = (c: OptimizeChange) =>
    [c.isExcluded && t('expression.flag.isExcluded'), c.includeDescendants && t('expression.flag.includeDescendants'), c.includeMapped && t('expression.flag.includeMapped')]
      .filter(Boolean)
      .join(', ')

  const columns: DataTableColumn<OptimizeChange & { key: string }>[] = [
    {
      id: 'action',
      header: t('expression.optimize_action'),
      accessor: (c) => t(`expression.optimize_${c.action}`),
      size: 110,
      cell: (c) => (
        <span className="inline-flex items-center gap-1">
          {c.action === 'removed' ? <MinusCircle size={12} className="text-destructive" /> : <PlusCircle size={12} className="text-primary" />}
          {t(`expression.optimize_${c.action}`)}
        </span>
      ),
    },
    { id: 'id', header: t('concept_sets.concept.id'), accessor: (c) => c.id, size: 100, align: 'right' },
    { id: 'name', header: t('concept_sets.concept.name'), accessor: (c) => c.name, size: 300 },
    { id: 'flags', header: t('expression.optimize_flags'), accessor: flags, size: 200 },
  ]

  const done = state.status === 'done' ? state : null
  const changed = !!done && done.result.changes.length > 0

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      kind="workbench"
      title={t('expression.optimize_title')}
      description={t('expression.optimize_description')}
      onConfirm={() => {
        if (done) onApply(done.result.items)
        onOpenChange(false)
      }}
      confirmLabel={t('expression.optimize_apply')}
      confirmDisabled={!changed}
      contentClassName="flex flex-col gap-3"
    >
      {state.status === 'running' && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          {t('expression.optimize_running')}
        </p>
      )}
      {state.status === 'unavailable' && (
        <NoticeBanner tone="warning" title={t('expression.no_vocabulary_title')} description={t('expression.no_vocabulary_description')} />
      )}
      {state.status === 'error' && <NoticeBanner tone="danger" title={t('expression.optimize_error')} description={state.error} />}
      {done && !changed && (
        <p className="flex items-center gap-2 text-sm">
          <CheckCircle2 size={16} className="text-primary" />
          {t('expression.optimize_optimal')}
        </p>
      )}
      {done && changed && (
        <>
          <p className="text-sm">
            {t('expression.optimize_summary', {
              count: done.result.changes.length,
              from: items.length,
              to: done.result.items.length,
            })}{' '}
            {done.result.identical && t('expression.optimize_identical', { count: done.result.before.size })}
          </p>
          {!done.result.identical && (
            <NoticeBanner
              tone="warning"
              title={t('expression.optimize_mismatch_title')}
              description={
                <span className="block space-y-1">
                  <span className="block">{t('expression.optimize_mismatch_description')}</span>
                  {done.result.lost.length > 0 && (
                    <span className="block">
                      {t('expression.optimize_lost', { count: done.result.lost.length })}:{' '}
                      {done.result.lost.slice(0, 50).map((id) => `${done.names.get(id) ?? ''} #${id}`).join(' · ')}
                    </span>
                  )}
                  {done.result.gained.length > 0 && (
                    <span className="block">
                      {t('expression.optimize_gained', { count: done.result.gained.length })}:{' '}
                      {done.result.gained.slice(0, 50).map((id) => `${done.names.get(id) ?? ''} #${id}`).join(' · ')}
                    </span>
                  )}
                </span>
              }
            />
          )}
          <DataTable
            data={done.result.changes.map((c, i) => ({ ...c, key: `${i}` }))}
            columns={columns}
            rowKey={(c) => c.key}
            cellTooltips="all"
            pageSize={100}
            density="compact"
          />
        </>
      )}
    </DialogShell>
  )
}
