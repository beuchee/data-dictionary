import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { HLJSApi } from 'highlight.js'
import './code-preview.css'

export type PreviewLanguage = 'sql' | 'json' | 'plaintext'

/** Above this, highlighting costs more than it helps: the text is shown plain. */
const MAX_HIGHLIGHT_CHARS = 200_000
/** Above this, only the head is shown; copy and download still give everything. */
const MAX_PREVIEW_CHARS = 400_000

let highlighter: Promise<HLJSApi> | null = null

/** highlight.js core with SQL and JSON only, loaded on first use. */
function loadHighlighter(): Promise<HLJSApi> {
  highlighter ??= Promise.all([
    import('highlight.js/lib/core'),
    import('highlight.js/lib/languages/sql'),
    import('highlight.js/lib/languages/json'),
  ]).then(([core, sql, json]) => {
    const hljs = core.default
    hljs.registerLanguage('sql', sql.default)
    hljs.registerLanguage('json', json.default)
    return hljs
  })
  return highlighter
}

interface CodePreviewProps {
  text: string
  language: PreviewLanguage
  className?: string
}

/** Read-only, highlighted view of an export. Long texts are cut, with a note saying so. */
export function CodePreview({ text, language, className }: CodePreviewProps) {
  const { t } = useTranslation()
  const truncated = text.length > MAX_PREVIEW_CHARS
  const shown = truncated ? text.slice(0, text.lastIndexOf('\n', MAX_PREVIEW_CHARS) + 1 || MAX_PREVIEW_CHARS) : text
  const [highlighted, setHighlighted] = useState<{ source: string; html: string } | null>(null)

  useEffect(() => {
    if (language === 'plaintext' || shown.length > MAX_HIGHLIGHT_CHARS) return
    let cancelled = false
    loadHighlighter()
      .then((hljs) => {
        if (cancelled) return
        // highlight.js escapes the source: the HTML holds only its own <span>s.
        setHighlighted({ source: shown, html: hljs.highlight(shown, { language }).value })
      })
      .catch((err: unknown) => console.error('Could not load the syntax highlighter', err))
    return () => {
      cancelled = true
    }
  }, [shown, language])

  const html = highlighted?.source === shown ? highlighted.html : null

  return (
    <div className={cn('export-code flex min-h-0 flex-col overflow-hidden rounded-md border bg-muted/30', className)}>
      <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed">
        {html !== null ? <code dangerouslySetInnerHTML={{ __html: html }} /> : <code>{shown}</code>}
      </pre>
      {truncated && (
        <p className="shrink-0 border-t px-3 py-1.5 text-xs text-muted-foreground">
          {t('export.preview_truncated', { shown: shown.length.toLocaleString(), total: text.length.toLocaleString() })}
        </p>
      )}
    </div>
  )
}
