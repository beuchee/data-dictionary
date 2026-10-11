import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Maximize, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CARD_W, HEADER_H, ROW_H, erdLayout, type ErdTone } from './erd-layout'

// Tone colours mark the table's role (v1's green / yellow / red), kept muted so the theme leads.
const HEADER_CLASS: Record<ErdTone, string> = {
  reference: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
  concept: 'bg-amber-500/20 text-amber-900 dark:text-amber-200',
  link: 'bg-rose-500/15 text-rose-800 dark:text-rose-300',
}
const EDGE_CLASS: Record<ErdTone, string> = {
  reference: 'stroke-emerald-500/60',
  concept: 'stroke-amber-500/60',
  link: 'stroke-rose-500/60',
}

interface View {
  scale: number
  x: number
  y: number
}

/** The OMOP vocabulary tables and their keys (v1's ERD): drag to pan, wheel or buttons to zoom. */
export function ErdTab() {
  const { t } = useTranslation()
  const layout = useMemo(() => erdLayout(), [])
  const viewportRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 })

  const fit = useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    const scale = Math.min(el.clientWidth / layout.width, el.clientHeight / layout.height, 1)
    setView({ scale, x: (el.clientWidth - layout.width * scale) / 2, y: (el.clientHeight - layout.height * scale) / 2 })
  }, [layout])

  useEffect(() => {
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [fit])

  // Non-passive, so the wheel zooms the diagram instead of scrolling the page.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setView((v) => ({ ...v, scale: Math.max(0.3, Math.min(2, v.scale + (e.deltaY > 0 ? -0.1 : 0.1))) }))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const zoom = (delta: number) => setView((v) => ({ ...v, scale: Math.max(0.3, Math.min(2, v.scale + delta)) }))

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    drag.current = { x: e.clientX - view.x, y: e.clientY - view.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent) => {
    const start = drag.current
    if (start) setView((v) => ({ ...v, x: e.clientX - start.x, y: e.clientY - start.y }))
  }
  const onPointerUp = () => {
    drag.current = null
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <p className="text-xs text-muted-foreground">{t('dev_tools.erd_hint')}</p>
        <div className="ml-auto flex gap-1">
          <Button variant="outline" size="icon-sm" aria-label={t('dev_tools.zoom_in')} onClick={() => zoom(0.15)}>
            <ZoomIn size={14} />
          </Button>
          <Button variant="outline" size="icon-sm" aria-label={t('dev_tools.zoom_out')} onClick={() => zoom(-0.15)}>
            <ZoomOut size={14} />
          </Button>
          <Button variant="outline" size="icon-sm" aria-label={t('dev_tools.zoom_fit')} onClick={fit}>
            <Maximize size={14} />
          </Button>
        </div>
      </div>
      <div
        ref={viewportRef}
        role="img"
        aria-label={t('dev_tools.erd_label')}
        className="relative h-[calc(100vh-16rem)] min-h-[420px] cursor-grab touch-none select-none overflow-hidden rounded-md border bg-muted/30 active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{ width: layout.width, height: layout.height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        >
          <svg width={layout.width} height={layout.height} className="absolute inset-0" aria-hidden>
            {layout.edges.map((e) => (
              <path key={e.key} d={e.d} fill="none" strokeWidth={1.5} className={EDGE_CLASS[e.tone]} />
            ))}
          </svg>
          {layout.boxes.map((b) => (
            <div
              key={b.table.name}
              className="absolute overflow-hidden rounded-md border bg-card shadow-sm"
              style={{ left: b.x, top: b.y, width: CARD_W }}
            >
              <div className={cn('flex items-center px-3 font-mono text-xs font-semibold', HEADER_CLASS[b.table.tone])} style={{ height: HEADER_H }}>
                {b.table.name}
              </div>
              <div className="pb-2">
                {b.table.columns.map((c) => (
                  <div key={c.name} className="flex items-center gap-1.5 px-3 font-mono text-[10px]" style={{ height: ROW_H }}>
                    {c.pk && <span className="rounded bg-primary/15 px-1 text-[10px] font-semibold text-primary">PK</span>}
                    {c.fk && <span className="rounded bg-muted px-1 text-[10px] font-semibold text-muted-foreground">FK</span>}
                    <span className="truncate">{c.name}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
