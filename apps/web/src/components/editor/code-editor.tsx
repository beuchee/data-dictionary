// Adapted from linkr@1310cf4a4 apps/web/src/components/editor/CodeEditor.tsx: a
// controlled Monaco editor, without Linkr's file store, shortcut registry or
// completion providers. Monaco is bundled (not fetched from a CDN, which the
// static build's cross-origin isolation would block) and only for SQL; import
// this module lazily, it weighs several megabytes.
import { useEffect, useRef } from 'react'
import Editor, { loader, type OnMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker'
import { useAppStore } from '@/stores/app-store'

declare global {
  interface Window {
    MonacoEnvironment?: { getWorker: (workerId: string, label: string) => Worker }
  }
}

window.MonacoEnvironment = { getWorker: () => new EditorWorker() }
loader.config({ monaco })

export interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  language?: 'sql'
  height?: string
  /** Cmd/Ctrl+Enter. */
  onRun?: () => void
  /** Accessible name of the editing area. */
  ariaLabel?: string
}

export function CodeEditor({ value, onChange, language = 'sql', height = '100%', onRun, ariaLabel }: CodeEditorProps) {
  const darkMode = useAppStore((s) => s.darkMode)
  // Monaco keeps the command registered on mount: read the current callback through a ref.
  const onRunRef = useRef(onRun)
  useEffect(() => {
    onRunRef.current = onRun
  })

  const handleMount: OnMount = (editor, m) => {
    editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.Enter, () => onRunRef.current?.())
  }

  return (
    <Editor
      height={height}
      language={language}
      value={value}
      onChange={(v) => onChange(v ?? '')}
      onMount={handleMount}
      theme={darkMode ? 'vs-dark' : 'vs'}
      options={{
        ariaLabel,
        minimap: { enabled: false },
        fontSize: 13,
        fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
        wordWrap: 'on',
        tabSize: 2,
        scrollBeyondLastLine: false,
        automaticLayout: true,
        padding: { top: 8 },
      }}
    />
  )
}
