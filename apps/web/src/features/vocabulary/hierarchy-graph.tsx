// Adapted from linkr@1310cf4a4 apps/web/src/features/warehouse/concept-mapping/components/ConceptDetailSheet.tsx
// (HierarchyGraph): typed on HierarchyNode, labels translated, theme read from the page.
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Expand, Maximize2, Minimize2, ZoomIn, ZoomOut } from 'lucide-react'
// vis-network is ~1.4 MB: imported dynamically, so it ships in its own chunk and
// loads only when a graph renders.
import type { DataSet, Edge, Network } from 'vis-network/standalone'
import { Button } from '@/components/ui/button'
import { copyText } from '@/lib/clipboard'
import type { ConceptHierarchy, HierarchyNode } from '@/lib/vocabulary'

interface HierarchyGraphProps {
  hierarchy: ConceptHierarchy
  /** The concept navigated from, drawn in another color. */
  originId: number | null
  /** Double-click on a node. */
  onNavigate: (conceptId: number) => void
  fullscreen: boolean
  onFullscreenChange: (fullscreen: boolean) => void
}

type NodeStyle = { bg: string; border: string; width: number }

function esc(s: string | number): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// A canvas cannot read CSS tokens: these are the graph's own data colors, a
// blue (current), an orange (origin) and a neutral, with a dark variant each.
function palette(dark: boolean) {
  return {
    edge: dark ? '#4b5563' : '#9ca3af',
    current: { bg: dark ? '#1d4ed8' : '#2563eb', border: dark ? '#1e40af' : '#1d4ed8' },
    origin: { bg: dark ? '#c2410c' : '#ea580c', border: dark ? '#9a3412' : '#c2410c' },
    other: { bg: dark ? '#374151' : '#6b7280', border: dark ? '#4b5563' : '#4b5563' },
    hover: { bg: dark ? '#111827' : '#ffffff', border: '#9ca3af', font: dark ? '#f9fafb' : '#111827' },
    pin: { border: '#2563eb' },
  }
}

export function HierarchyGraph({ hierarchy, originId, onNavigate, fullscreen, onFullscreenChange }: HierarchyGraphProps) {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLDivElement>(null)
  const networkRef = useRef<Network | null>(null)
  const nodesRef = useRef<DataSet<{ id: number; color: unknown; borderWidth: number; font?: unknown }> | null>(null)
  const stylesRef = useRef<Map<number, NodeStyle>>(new Map())
  const pinnedRef = useRef<number | null>(null)
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const conceptsRef = useRef<Map<number, HierarchyNode>>(new Map())
  const onNavigateRef = useRef(onNavigate)
  const tRef = useRef(t)

  useEffect(() => {
    onNavigateRef.current = onNavigate
    tRef.current = t
  })

  const hideTooltip = useCallback(() => {
    document.querySelectorAll('.dd-hierarchy-tooltip').forEach((el) => el.remove())
  }, [])

  const restyle = useCallback((id: number, mode: 'hover' | 'pin' | 'rest') => {
    const ds = nodesRef.current
    if (!ds) return
    const dark = document.documentElement.classList.contains('dark')
    const p = palette(dark)
    if (mode === 'rest') {
      const s = stylesRef.current.get(id)
      if (!s) return
      ds.update({ id, color: { background: s.bg, border: s.border, highlight: { background: s.bg, border: s.border } }, font: { color: '#ffffff', size: 11 }, borderWidth: s.width })
      return
    }
    const border = mode === 'pin' ? p.pin.border : p.hover.border
    ds.update({ id, color: { background: p.hover.bg, border, highlight: { background: p.hover.bg, border } }, font: { color: p.hover.font, size: 11 }, borderWidth: mode === 'pin' ? 3 : 2 })
  }, [])

  const pin = useCallback(
    (id: number | null) => {
      if (pinnedRef.current !== null && pinnedRef.current !== id) restyle(pinnedRef.current, 'rest')
      if (id !== null) restyle(id, 'pin')
      pinnedRef.current = id
    },
    [restyle],
  )

  const showTooltip = useCallback(
    (id: number, pos: { x: number; y: number }, pinned: boolean) => {
      const c = conceptsRef.current.get(id)
      const canvas = canvasRef.current
      if (!c || !canvas) return
      hideTooltip()
      const tr = tRef.current
      const standard =
        c.standardConcept === 'S'
          ? tr('vocabulary.standard')
          : c.standardConcept === 'C'
            ? tr('vocabulary.classification')
            : tr('vocabulary.non_standard')
      const copy = (v: string) =>
        pinned
          ? `<button class="dd-ht-copy" data-copy="${esc(v)}" style="cursor:pointer;background:none;border:none;padding:0 0 0 4px;opacity:.6;font-size:10px;color:inherit">${esc(tr('common.copy'))}</button>`
          : ''
      const row = (label: string, value: string, mono = false, withCopy = false) =>
        `<tr><td style="color:var(--muted-foreground);padding:1px 8px 1px 0;white-space:nowrap;font-size:11px">${esc(label)}</td>` +
        `<td style="font-size:11px${mono ? ';font-family:monospace' : ''}">${esc(value)}${withCopy ? copy(value) : ''}</td></tr>`
      const tip = document.createElement('div')
      tip.className = 'dd-hierarchy-tooltip'
      tip.style.cssText = `position:fixed;z-index:9999;background:var(--popover);color:var(--popover-foreground);border:1px solid var(--border);border-radius:6px;padding:8px 10px;box-shadow:0 4px 16px rgba(0,0,0,.18);max-width:320px;pointer-events:${pinned ? 'auto' : 'none'}`
      tip.innerHTML =
        `<div style="font-weight:600;font-size:12px;margin-bottom:6px;line-height:1.3">${esc(c.conceptName)}</div>` +
        '<table style="border-collapse:collapse">' +
        row(tr('vocabulary.col_vocabulary'), c.vocabularyId) +
        row(tr('vocabulary.concept_id'), String(c.conceptId), true, true) +
        (c.conceptCode ? row(tr('vocabulary.concept_code'), c.conceptCode, true, true) : '') +
        (c.domainId ? row(tr('vocabulary.domain'), c.domainId) : '') +
        (c.conceptClassId ? row(tr('vocabulary.concept_class'), c.conceptClassId) : '') +
        row(tr('vocabulary.standard_concept'), standard) +
        row(tr('vocabulary.validity'), c.invalidReason ? c.invalidReason : tr('vocabulary.valid')) +
        '</table>'
      if (pinned) {
        tip.addEventListener('pointerdown', (e) => e.stopPropagation())
        tip.querySelectorAll<HTMLButtonElement>('.dd-ht-copy').forEach((btn) =>
          btn.addEventListener('click', (e) => {
            e.stopPropagation()
            void copyText(btn.dataset.copy ?? '')
          }),
        )
      }
      const rect = canvas.getBoundingClientRect()
      document.body.appendChild(tip)
      const tipRect = tip.getBoundingClientRect()
      let x = rect.left + pos.x + 14
      let y = rect.top + pos.y + 14
      if (x + tipRect.width > window.innerWidth - 10) x = Math.max(10, rect.left + pos.x - tipRect.width - 14)
      if (y + tipRect.height > window.innerHeight - 10) y = Math.max(10, rect.top + pos.y - tipRect.height - 14)
      tip.style.left = `${x}px`
      tip.style.top = `${y}px`
    },
    [hideTooltip],
  )

  useEffect(() => {
    let cancelled = false
    let cleanup: (() => void) | undefined
    void import('vis-network/standalone').then(({ Network: NetworkClass, DataSet: DataSetClass }) => {
      const canvas = canvasRef.current
      if (cancelled || !canvas) return
      const dark = document.documentElement.classList.contains('dark')
      const p = palette(dark)
      const selfId = hierarchy.conceptId
      conceptsRef.current = new Map(hierarchy.nodes.map((n) => [n.conceptId, n]))
      stylesRef.current = new Map()
      const truncate = (s: string) => (s.length > 30 ? `${s.slice(0, 28)}…` : s)
      const nodes = hierarchy.nodes.map((n) => {
        const col = n.conceptId === selfId ? p.current : n.conceptId === originId ? p.origin : p.other
        const width = n.conceptId === selfId ? 2 : 1
        stylesRef.current.set(n.conceptId, { bg: col.bg, border: col.border, width })
        return {
          id: n.conceptId,
          level: n.hierarchyLevel,
          label: `${truncate(n.conceptName)}\n[${n.vocabularyId}]`,
          shape: 'box' as const,
          color: { background: col.bg, border: col.border, highlight: { background: col.bg, border: col.border } },
          font: { color: '#ffffff', size: 11 },
          widthConstraint: { minimum: 100, maximum: 200 },
          borderWidth: width,
        }
      })
      const edges = hierarchy.edges.map((e) => ({ from: e.fromId, to: e.toId, arrows: 'to' as const }))
      const nodeSet = new DataSetClass(nodes)
      nodesRef.current = nodeSet as unknown as DataSet<{ id: number; color: unknown; borderWidth: number; font?: unknown }>
      pinnedRef.current = null
      hideTooltip()
      const network = new NetworkClass(
        canvas,
        { nodes: nodeSet, edges: new DataSetClass<Edge>(edges) },
        {
          layout: { hierarchical: { enabled: true, direction: 'UD', sortMethod: 'directed', levelSeparation: 60, nodeSpacing: 100 } },
          physics: false,
          interaction: { hover: true, zoomView: true, dragView: true, dragNodes: false, selectConnectedEdges: false, tooltipDelay: 99999, keyboard: false },
          nodes: { chosen: false },
          edges: { color: { color: p.edge }, smooth: { enabled: true, type: 'cubicBezier', roundness: 0.5 } },
        },
      )
      networkRef.current = network
      let showTimer: ReturnType<typeof setTimeout> | undefined
      let hideTimer: ReturnType<typeof setTimeout> | undefined
      network.on('hoverNode', (params) => {
        clearTimeout(showTimer)
        clearTimeout(hideTimer)
        const id = Number(params.node)
        if (pinnedRef.current !== id) restyle(id, 'hover')
        if (pinnedRef.current !== null) return
        const pos = params.pointer?.DOM ?? { x: 0, y: 0 }
        showTimer = setTimeout(() => pinnedRef.current === null && showTooltip(id, pos, false), 250)
      })
      network.on('blurNode', (params) => {
        clearTimeout(showTimer)
        const id = Number(params.node)
        if (pinnedRef.current !== id) restyle(id, 'rest')
        if (pinnedRef.current !== null) return
        hideTimer = setTimeout(() => pinnedRef.current === null && hideTooltip(), 150)
      })
      network.on('click', (params) => {
        if (clickTimer.current) clearTimeout(clickTimer.current)
        const id = params.nodes?.length === 1 ? Number(params.nodes[0]) : null
        if (id === null || pinnedRef.current === id) {
          pin(null)
          hideTooltip()
          return
        }
        pin(id)
        const pos = params.pointer?.DOM ?? { x: 0, y: 0 }
        // Waits so a double-click does not flash the tooltip first.
        clickTimer.current = setTimeout(() => pinnedRef.current === id && showTooltip(id, pos, true), 280)
      })
      network.on('doubleClick', (params) => {
        if (clickTimer.current) clearTimeout(clickTimer.current)
        const id = params.nodes?.length === 1 ? Number(params.nodes[0]) : null
        if (id === null || id === selfId) return
        pin(null)
        hideTooltip()
        requestAnimationFrame(() => onNavigateRef.current(id))
      })
      cleanup = () => {
        clearTimeout(showTimer)
        clearTimeout(hideTimer)
        hideTooltip()
        network.destroy()
        networkRef.current = null
      }
    })
    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [hierarchy, originId, hideTooltip, pin, restyle, showTooltip])

  const zoom = (factor: number) => {
    const network = networkRef.current
    if (!network) return
    network.moveTo({ scale: network.getScale() * factor, animation: { duration: 250, easingFunction: 'easeInOutQuad' } })
  }
  const fit = () => networkRef.current?.fit({ animation: { duration: 350, easingFunction: 'easeInOutQuad' } })

  return (
    <div className="relative h-full w-full">
      <div ref={canvasRef} className="h-full w-full" />
      <div className="absolute right-3 bottom-3 flex flex-col gap-1">
        <Button variant="outline" size="icon-sm-tight" aria-label={t('vocabulary.zoom_in')} onClick={() => zoom(1.3)}>
          <ZoomIn size={13} />
        </Button>
        <Button variant="outline" size="icon-sm-tight" aria-label={t('vocabulary.zoom_out')} onClick={() => zoom(1 / 1.3)}>
          <ZoomOut size={13} />
        </Button>
        <Button variant="outline" size="icon-sm-tight" aria-label={t('vocabulary.fit')} onClick={fit}>
          <Expand size={13} />
        </Button>
        <Button
          variant="outline"
          size="icon-sm-tight"
          aria-label={fullscreen ? t('vocabulary.exit_fullscreen') : t('vocabulary.fullscreen')}
          onClick={() => onFullscreenChange(!fullscreen)}
        >
          {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </Button>
      </div>
    </div>
  )
}
