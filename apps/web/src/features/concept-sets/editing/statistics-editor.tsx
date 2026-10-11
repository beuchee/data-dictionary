import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { LazyCodeEditor } from '@/components/editor/lazy-code-editor'
import { parseStatistics, statisticsEditorText, statisticsTemplateText } from '../lib/editing'
import { useConceptSetEditor } from './editor-store'
import type { PendingEdits } from '@/components/editor/code-editor'

const EDITOR_KEY = 'statistics'

/**
 * The Statistics tab in edit mode: `distributionStats` as JSON (v1's format),
 * starting from the "All patients" template when the set has none. Invalid
 * JSON is reported and blocks saving until fixed.
 */
export function StatisticsEditor() {
  const { t } = useTranslation()
  const working = useConceptSetEditor((s) => s.working)
  const update = useConceptSetEditor((s) => s.update)
  const setError = useConceptSetEditor((s) => s.setError)
  const registerFlush = useConceptSetEditor((s) => s.registerFlush)
  const error = useConceptSetEditor((s) => s.errors[EDITOR_KEY] ?? null)
  // The text is the editor's own: re-deriving it from the parsed value would reformat as one types.
  const [text, setText] = useState(() => (working ? statisticsEditorText(working) : ''))
  const [revision, setRevision] = useState(0)
  const pending = useRef<PendingEdits | null>(null)

  useEffect(() => registerFlush(() => pending.current?.flush()), [registerFlush])
  useEffect(() => () => setError(EDITOR_KEY, null), [setError])

  const apply = (next: string) => {
    setText(next)
    const parsed = parseStatistics(next)
    if (!parsed.ok) {
      setError(EDITOR_KEY, parsed.error === 'not_object' ? t('concept_sets.edit.stats_not_object') : parsed.error)
      return
    }
    setError(EDITOR_KEY, null)
    update((cs) => ({ ...cs, metadata: { ...cs.metadata, distributionStats: parsed.value } }))
  }

  const reset = () => {
    pending.current?.discard()
    apply(statisticsTemplateText())
    // Remount the editor on the template text.
    setRevision((r) => r + 1)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t('concept_sets.edit.stats_hint')}</p>
        <Button variant="outline" size="xs" onClick={reset}>
          <RotateCcw size={12} />
          {t('concept_sets.edit.stats_reset')}
        </Button>
      </div>
      {error && <NoticeBanner tone="danger" title={t('concept_sets.edit.stats_invalid')} description={error} />}
      <div className="h-[calc(100vh-22rem)] min-h-64 overflow-hidden rounded-md border">
        <LazyCodeEditor key={revision} value={text} language="json" onChange={apply} pendingEditsRef={pending} />
      </div>
    </div>
  )
}
