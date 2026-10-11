// Ported from legacy/concept-sets.js (openImportModal, submitImport).
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2 } from 'lucide-react'
import { DialogShell } from '@/components/ui/dialog-shell'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { Textarea } from '@/components/ui/textarea'
import { addItems, parseAtlasExpression } from '../lib/expression'
import type { ExpressionItem } from '@data-dictionary/format'

interface ImportAtlasDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: ExpressionItem[]
  onChange: (items: ExpressionItem[]) => void
}

/**
 * Pastes an ATLAS concept set expression (or an INDICATE / ATLAS concept set
 * file) into the expression: its items are appended, concepts already present
 * skipped. The items keep the metadata the JSON carries.
 */
export function ImportAtlasDialog({ open, onOpenChange, items, onChange }: ImportAtlasDialogProps) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ added: number; skipped: number } | null>(null)

  const submit = () => {
    const parsed = parseAtlasExpression(text)
    if (!parsed.ok) {
      setError(t(`expression.import.error_${parsed.error}`, { detail: parsed.detail ?? '' }))
      return
    }
    const result = addItems(items, parsed.items)
    onChange(result.items)
    setError(null)
    setDone({ added: result.added, skipped: result.skipped + parsed.skipped })
    setText('')
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      kind="workbench"
      title={t('expression.import.title')}
      description={t('expression.import.description')}
      onConfirm={submit}
      confirmLabel={t('expression.import.confirm')}
      confirmDisabled={!text.trim()}
      noEnterSubmit
      contentClassName="flex flex-col gap-3"
    >
      {done && (
        <p className="flex items-center gap-2 text-xs">
          <CheckCircle2 size={14} className="shrink-0 text-primary" />
          {t('expression.import.done', { count: done.added })}
          {done.skipped ? ` ${t('expression.import.skipped', { count: done.skipped })}` : ''}
        </p>
      )}
      {error && <NoticeBanner tone="danger" title={error} />}
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'{\n  "items": [ { "concept": { "CONCEPT_ID": 3027018, … }, "includeDescendants": false, … } ]\n}'}
        className="min-h-[50vh] flex-1 font-mono text-xs"
        autoFocus
        spellCheck={false}
      />
    </DialogShell>
  )
}
