import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DialogShell } from '@/components/ui/dialog-shell'
import { FormField } from '@/components/ui/form-field'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { downloadText } from '@/lib/export'
import { findDraft } from '@/lib/drafts/overlay'
import { cn } from '@/lib/utils'
import { conceptSetKey, useCatalogStore } from '@/stores/catalog-store'
import { useDraftsStore } from '@/stores/drafts-store'
import { bulkExportFilename, bulkExportIds, bulkExportJson, loadAll, type BulkExportMode } from '../lib/bulk-export'
import { sortCategories } from '../lib/list-filters'
import type { ConceptSet } from '@data-dictionary/format'
import type { ConceptSetSummary } from '@/lib/data'

interface BulkExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The list as the user sees it (drafts overlaid). */
  summaries: readonly ConceptSetSummary[]
  selected: ReadonlySet<number>
  lang: string
}

/**
 * v1's bulk export: the files of the selected sets, of one category, or of all
 * of them, as one JSON array (a set with a draft is exported as its draft).
 */
export function BulkExportDialog({ open, onOpenChange, summaries, selected, lang }: BulkExportDialogProps) {
  const { t } = useTranslation()
  const drafts = useDraftsStore((s) => s.drafts)
  const loadConceptSet = useCatalogStore((s) => s.loadConceptSet)
  const [mode, setMode] = useState<BulkExportMode>('all')
  const [category, setCategory] = useState('')
  const [busy, setBusy] = useState(false)
  const [missing, setMissing] = useState(0)

  const categories = useMemo(
    () => sortCategories(new Set(summaries.map((s) => s.translations[lang]?.category ?? '').filter(Boolean))),
    [summaries, lang],
  )

  // Reset when the dialog opens.
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setMode(selected.size > 0 ? 'selected' : 'all')
      setCategory((c) => c || categories[0] || '')
      setMissing(0)
    }
  }

  const ids = bulkExportIds(summaries, mode, { selected: new Set(selected), category, lang })

  const load = async (id: number): Promise<ConceptSet | null> => {
    const draft = findDraft(drafts, 'concept-set', id)
    if (draft) return draft.content
    await loadConceptSet(id)
    return useCatalogStore.getState().conceptSetDetails[conceptSetKey(id)]?.data ?? null
  }

  const run = async () => {
    setBusy(true)
    try {
      const result = await loadAll(ids, load)
      setMissing(result.missing)
      downloadText(bulkExportFilename(mode, category), bulkExportJson(result.conceptSets), 'application/json')
      if (result.missing === 0) onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  const modes: BulkExportMode[] = selected.size > 0 ? ['selected', 'category', 'all'] : ['category', 'all']

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={t('concept_sets.bulk_export.title')}
      description={t('concept_sets.bulk_export.description')}
      onConfirm={() => void run()}
      confirmLabel={t('concept_sets.bulk_export.download', { count: ids.length })}
      confirmDisabled={ids.length === 0}
      busy={busy}
    >
      <div className="grid gap-2" role="radiogroup" aria-label={t('concept_sets.bulk_export.title')}>
        {modes.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => setMode(m)}
            className={cn('rounded-md border p-2.5 text-left text-sm transition-colors', mode === m ? 'border-primary bg-primary/5' : 'hover:bg-accent')}
          >
            {t(`concept_sets.bulk_export.mode_${m}`, { count: m === 'selected' ? selected.size : summaries.length })}
          </button>
        ))}
      </div>
      {mode === 'category' && (
        <FormField label={t('concept_sets.columns.category')}>
          {({ id }) => (
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id={id} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
      )}
      {missing > 0 && <NoticeBanner tone="warning" title={t('concept_sets.bulk_export.missing', { count: missing })} />}
    </DialogShell>
  )
}
