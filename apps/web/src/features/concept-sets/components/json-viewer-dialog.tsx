import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { copyText } from '@/lib/clipboard'
import { serialize } from '@data-dictionary/format'
import type { ConceptSet } from '@/lib/data'

interface JsonViewerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  conceptSet: ConceptSet
}

/** The concept set as its file reads on disk (the format package's canonical serializer). */
export function JsonViewerDialog({ open, onOpenChange, conceptSet }: JsonViewerDialogProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const text = useMemo(() => (open ? serialize(conceptSet, { kind: 'concept-set' }) : ''), [open, conceptSet])

  const copy = () => {
    void copyText(text).then((ok) => {
      if (!ok) return
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      kind="workbench"
      title={t('concept_sets.json.title', { id: conceptSet.id, version: conceptSet.version })}
      description={`concept_sets/${conceptSet.id}.json`}
      footerExtra={
        <Button variant="outline" onClick={copy}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? t('common.copied') : t('common.copy')}
        </Button>
      }
    >
      <pre className="min-h-full rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre">{text}</pre>
    </DialogShell>
  )
}
