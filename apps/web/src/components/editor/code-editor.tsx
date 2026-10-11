// Adapted from linkr@1310cf4a4 apps/web/src/components/editor/CodeEditor.tsx (no
// shortcut store, run commands or completion; Monaco bundled by ./monaco-setup;
// built-in vs / vs-dark themes following the app's dark mode).
import { useCallback, useEffect, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { useAppStore } from '@/stores/app-store'
import './monaco-setup'
import type * as Monaco from 'monaco-editor'

/**
 * Control over an editor's not-yet-committed keystrokes: typing is debounced,
 * so anything that reads the value from the parent (saving) must `flush()`
 * first; `discard()` drops them (reverting).
 */
export interface PendingEdits {
  flush: () => void
  discard: () => void
}

export interface CodeEditorProps {
  value: string
  language: 'markdown' | 'json' | 'plaintext' | 'sql'
  onChange?: (value: string) => void
  readOnly?: boolean
  height?: string
  /** Receives the Monaco editor once mounted (toolbar actions, scroll sync). */
  onMount?: (editor: Monaco.editor.IStandaloneCodeEditor) => void
  pendingEditsRef?: React.RefObject<PendingEdits | null>
  /** Soft-wrap long lines (prose). */
  wordWrap?: boolean
  /** Cmd/Ctrl+S inside the editor. */
  onSave?: () => void
  /** Cmd/Ctrl+Enter, with the editor's current text (pending edits are flushed first). */
  onRun?: (value: string) => void
  ariaLabel?: string
}

export function CodeEditor({
  value,
  language,
  onChange,
  readOnly = false,
  height = '100%',
  onMount,
  pendingEditsRef,
  wordWrap = false,
  onSave,
  onRun,
  ariaLabel,
}: CodeEditorProps) {
  const darkMode = useAppStore((s) => s.darkMode)

  // Monaco owns the live text; the parent gets it debounced. While an edit is
  // pending the editor is fed its OWN text: @monaco-editor/react reconciles on
  // `value !== model.getValue()`, so a stale parent value would undo the keystroke.
  const [pending, setPending] = useState<string | null>(null)
  const pendingRef = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const onRunRef = useRef(onRun)
  const onMountRef = useRef(onMount)
  useEffect(() => {
    onChangeRef.current = onChange
    onSaveRef.current = onSave
    onRunRef.current = onRun
    onMountRef.current = onMount
  })

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const text = pendingRef.current
    if (text === null) return
    pendingRef.current = null
    setPending(null)
    onChangeRef.current?.(text)
  }, [])

  const discard = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    pendingRef.current = null
    setPending(null)
  }, [])

  const handleChange = useCallback(
    (next: string | undefined) => {
      pendingRef.current = next ?? ''
      setPending(next ?? '')
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(flush, 300)
    },
    [flush],
  )

  // Unmounting must not drop the last keystrokes.
  useEffect(() => flush, [flush])

  useEffect(() => {
    if (!pendingEditsRef) return
    pendingEditsRef.current = { flush, discard }
    return () => {
      pendingEditsRef.current = null
    }
  }, [pendingEditsRef, flush, discard])

  const handleMount: OnMount = useCallback(
    (editor) => {
      // A capture listener on this editor's node rather than addCommand, whose
      // keybindings are shared by every editor on the page (the last one wins).
      const node = editor.getDomNode()
      const onKeyDown = (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
          e.preventDefault()
          e.stopPropagation()
          flush()
          onSaveRef.current?.()
        }
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && onRunRef.current) {
          e.preventDefault()
          e.stopPropagation()
          flush()
          onRunRef.current(editor.getValue())
        }
      }
      node?.addEventListener('keydown', onKeyDown, true)
      editor.onDidDispose(() => node?.removeEventListener('keydown', onKeyDown, true))
      onMountRef.current?.(editor)
    },
    [flush],
  )

  return (
    <Editor
      height={height}
      language={language}
      value={pending ?? value}
      onChange={handleChange}
      onMount={handleMount}
      theme={darkMode ? 'vs-dark' : 'vs'}
      options={{
        ariaLabel,
        readOnly,
        domReadOnly: readOnly,
        minimap: { enabled: false },
        fontSize: 12,
        fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
        lineNumbers: 'on',
        tabSize: 2,
        wordWrap: wordWrap ? 'on' : 'off',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        padding: { top: 8 },
      }}
    />
  )
}

export default CodeEditor
