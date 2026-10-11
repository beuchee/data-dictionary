// Adapted from linkr@1310cf4a4 apps/web/src/components/editor/SplitEditorPreview.tsx:
// the divider only; the scroll sync moved to the caller, since a Monaco editor
// scrolls through its own API rather than a DOM element.
import { useCallback, useRef, useState } from 'react'

interface SplitEditorPreviewProps {
  /** Left pane: the source. */
  editor: React.ReactNode
  /** Right pane: the rendered result. */
  preview: React.ReactNode
  /** The scrolling element of the preview pane, for the caller's scroll sync. */
  previewRef?: React.Ref<HTMLDivElement>
}

const DEFAULT_SPLIT = 50
const MIN_SPLIT = 20
const MAX_SPLIT = 80

/** Source and preview side by side, with a draggable divider. */
export function SplitEditorPreview({ editor, preview, previewRef }: SplitEditorPreviewProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [split, setSplit] = useState(DEFAULT_SPLIT)
  const [dragging, setDragging] = useState(false)

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
  }, [])

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return
      const rect = rootRef.current?.getBoundingClientRect()
      if (!rect || rect.width === 0) return
      const pct = ((e.clientX - rect.left) / rect.width) * 100
      setSplit(Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, pct)))
    },
    [dragging],
  )

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId)
    setDragging(false)
  }, [])

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 items-stretch">
      <div className="min-w-0 overflow-hidden" style={{ width: `${split}%` }}>
        {editor}
      </div>

      {/* Wider hit area than the 1px line it draws. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={Math.round(split)}
        className="relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div className={`pointer-events-none mx-auto h-full w-px transition-colors ${dragging ? 'bg-primary' : 'bg-border'}`} />
      </div>

      <div ref={previewRef} className="min-w-0 overflow-y-auto p-4" style={{ width: `${100 - split}%` }}>
        {preview}
      </div>

      {/* While dragging, swallow pointer events so the editor does not start selecting. */}
      {dragging && <div className="fixed inset-0 z-20 cursor-col-resize" />}
    </div>
  )
}
