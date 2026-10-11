import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { MarkdownEditor } from '@/components/editor/markdown-editor'
import { cn } from '@/lib/utils'
import { useInstanceConfig } from '@/stores/config-store'
import { withLongDescription } from '../lib/editing'
import { useConceptSetEditor } from './editor-store'
import type { PendingEdits } from '@/components/editor/code-editor'

/**
 * The Comments tab in edit mode: the expert commentary (`longDescription`) of
 * each language of the instance, edited one language at a time, Markdown
 * source beside its preview.
 */
export function CommentsEditor({ initialLang }: { initialLang: string }) {
  const { t } = useTranslation()
  const config = useInstanceConfig()
  const working = useConceptSetEditor((s) => s.working)
  const update = useConceptSetEditor((s) => s.update)
  const registerFlush = useConceptSetEditor((s) => s.registerFlush)
  const [lang, setLang] = useState(config.languages.includes(initialLang) ? initialLang : config.defaultLanguage)
  const pending = useRef<PendingEdits | null>(null)

  useEffect(() => registerFlush(() => pending.current?.flush()), [registerFlush])

  if (!working) return null
  const value = working.metadata?.translations?.[lang]?.longDescription ?? ''

  const switchTo = (next: string) => {
    pending.current?.flush()
    setLang(next)
  }

  return (
    <MarkdownEditor
      // One editor per language: switching remounts it on the other text.
      key={lang}
      value={value}
      onChange={(text) => update((cs) => withLongDescription(cs, lang, text))}
      pendingEditsRef={pending}
      height="calc(100vh - 20rem)"
      toolbarExtra={
        config.languages.length > 1 && (
          <div className="flex items-center gap-0.5" role="group" aria-label={t('concept_sets.edit.comment_language')}>
            {config.languages.map((l) => (
              <Button
                key={l}
                size="xs"
                variant={l === lang ? 'secondary' : 'ghost'}
                aria-pressed={l === lang}
                className={cn(l === lang && 'font-semibold')}
                onClick={() => switchTo(l)}
              >
                {l.toUpperCase()}
              </Button>
            ))}
          </div>
        )
      }
    />
  )
}
