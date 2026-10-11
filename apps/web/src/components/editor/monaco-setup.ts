/**
 * Monaco served from this build rather than @monaco-editor/react's default CDN,
 * so a self-hosted instance without internet access still has its editors. Only
 * the editor core plus the Markdown, JSON and SQL languages are bundled, in the lazy
 * chunk of `code-editor.tsx`: nothing here reaches the main bundle.
 */
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js'
import 'monaco-editor/esm/vs/language/json/monaco.contribution.js'
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker.js?worker'

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    return label === 'json' ? new JsonWorker() : new EditorWorker()
  },
}

loader.config({ monaco })

export { monaco }
