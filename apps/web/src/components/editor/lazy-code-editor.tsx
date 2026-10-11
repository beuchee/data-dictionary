import { Suspense, lazy } from 'react'
import { Loader2 } from 'lucide-react'
import type { CodeEditorProps } from './code-editor'

// Monaco is a few megabytes: fetched the first time an editor shows, never in the main bundle.
const CodeEditor = lazy(() => import('./code-editor'))

/** `CodeEditor`, loaded on demand, with a spinner meanwhile. */
export function LazyCodeEditor(props: CodeEditorProps) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full min-h-24 items-center justify-center">
          <Loader2 size={14} className="animate-spin text-muted-foreground" />
        </div>
      }
    >
      <CodeEditor {...props} />
    </Suspense>
  )
}
