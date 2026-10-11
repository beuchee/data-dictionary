import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { copyText } from '@/lib/clipboard'

interface CopyExportButtonProps {
  /** Built on click, so a large export is not copied until asked for. */
  getText: () => string
  disabled?: boolean
}

/** "Copy to clipboard", turning into a tick for a moment, or saying it failed. */
export function CopyExportButton({ getText, disabled }: CopyExportButtonProps) {
  const { t } = useTranslation()
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const copy = async () => {
    const ok = await copyText(getText())
    setState(ok ? 'copied' : 'failed')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), ok ? 2000 : 4000)
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" disabled={disabled} onClick={() => void copy()} className="gap-1.5">
        {state === 'copied' ? <Check size={14} /> : <Copy size={14} />}
        {state === 'copied' ? t('export.copied') : t('export.copy')}
      </Button>
      {state === 'failed' && <span role="alert" className="text-xs text-destructive">{t('export.copy_failed')}</span>}
    </div>
  )
}
