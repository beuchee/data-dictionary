import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LazyCodeEditor } from './lazy-code-editor'
import { applyMarkdownFormat, type MarkdownFormat } from './markdown-format'
import { MarkdownRenderer } from './markdown-renderer'
import { MarkdownToolbar } from './markdown-toolbar'
import { SplitEditorPreview } from './split-editor-preview'
import type { PendingEdits } from './code-editor'
import type * as Monaco from 'monaco-editor'

interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  /** CSS height of the whole editor (toolbar included). */
  height?: string
  /** Right side of the toolbar (a language switch…). */
  toolbarExtra?: React.ReactNode
  pendingEditsRef?: React.RefObject<PendingEdits | null>
  onSave?: () => void
}

/** How long the driving pane keeps the scroll lock after its last scroll event. */
const SYNC_RELEASE_MS = 120

/**
 * Markdown source (Monaco, lazy-loaded) beside its rendered preview, with the
 * formatting toolbar. The panes scroll together proportionally: a heading is
 * one line on the left and a block on the right, so pixels would drift apart.
 */
export function MarkdownEditor({ value, onChange, height = '60vh', toolbarExtra, pendingEditsRef, onSave }: MarkdownEditorProps) {
  const { t } = useTranslation()
  const [editor, setEditor] = useState<Monaco.editor.IStandaloneCodeEditor | null>(null)
  // The preview follows the editor's live text, not the debounced value.
  const [live, setLive] = useState(value)
  const previewRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLive(value)
  }, [value])

  useEffect(() => {
    const preview = previewRef.current
    if (!editor || !preview) return
    let lock: 'editor' | 'preview' | null = null
    let release: ReturnType<typeof setTimeout> | undefined
    const hold = (side: 'editor' | 'preview') => {
      lock = side
      clearTimeout(release)
      release = setTimeout(() => {
        lock = null
      }, SYNC_RELEASE_MS)
    }
    const editorMax = () => Math.max(0, editor.getScrollHeight() - editor.getLayoutInfo().height)
    const previewMax = () => Math.max(0, preview.scrollHeight - preview.clientHeight)

    const fromEditor = editor.onDidScrollChange(() => {
      if (lock === 'preview') return
      hold('editor')
      const max = editorMax()
      preview.scrollTop = max > 0 ? (editor.getScrollTop() / max) * previewMax() : 0
    })
    const contentChange = editor.onDidChangeModelContent(() => setLive(editor.getValue()))
    const fromPreview = () => {
      if (lock === 'editor') return
      hold('preview')
      const max = previewMax()
      editor.setScrollTop(max > 0 ? (preview.scrollTop / max) * editorMax() : 0)
    }
    preview.addEventListener('scroll', fromPreview, { passive: true })
    return () => {
      fromEditor.dispose()
      contentChange.dispose()
      preview.removeEventListener('scroll', fromPreview)
      clearTimeout(release)
    }
  }, [editor])

  const format = useCallback(
    (kind: MarkdownFormat) => {
      const model = editor?.getModel()
      const selection = editor?.getSelection()
      if (!editor || !model || !selection) return
      const text = model.getValue()
      const start = model.getOffsetAt(selection.getStartPosition())
      const end = model.getOffsetAt(selection.getEndPosition())
      const next = applyMarkdownFormat(text, start, end, kind)
      // One edit over the whole text, pushed on the undo stack (Cmd+Z reverts it).
      editor.pushUndoStop()
      editor.executeEdits('markdown-toolbar', [{ range: model.getFullModelRange(), text: next.text }])
      editor.pushUndoStop()
      const from = model.getPositionAt(next.cursorStart)
      const to = model.getPositionAt(next.cursorEnd)
      editor.setSelection({ startLineNumber: from.lineNumber, startColumn: from.column, endLineNumber: to.lineNumber, endColumn: to.column })
      editor.focus()
    },
    [editor],
  )

  return (
    <div className="flex flex-col overflow-hidden rounded-md border" style={{ height }}>
      <MarkdownToolbar onFormat={format}>{toolbarExtra}</MarkdownToolbar>
      <SplitEditorPreview
        previewRef={previewRef}
        editor={
          <LazyCodeEditor
            value={value}
            language="markdown"
            onChange={onChange}
            onMount={setEditor}
            pendingEditsRef={pendingEditsRef}
            onSave={onSave}
            wordWrap
          />
        }
        preview={
          live.trim() ? (
            <MarkdownRenderer content={live} />
          ) : (
            <p className="text-xs italic text-muted-foreground">{t('editor.preview_empty')}</p>
          )
        }
      />
    </div>
  )
}
