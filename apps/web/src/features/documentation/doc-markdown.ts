import { foldAccents } from '@/lib/fold-accents'

export interface DocHeading {
  level: number
  text: string
  /** Unique within the page: a repeated heading gets `-1`, `-2`… as on GitHub. */
  id: string
  /** 1-based line of the heading in the Markdown it was read from (the renderer's `node.position.start.line`). */
  line: number
}

/** Heading levels listed in the on-page table of contents (v1 listed h2–h4 too). */
export const TOC_LEVELS = [2, 3, 4] as const

/** Anchor slug of a heading's text; same rule as `markdown-renderer.tsx` (`getHeadingId`). */
export function headingId(text: string): string {
  return foldAccents(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

/**
 * The visible text of a Markdown heading line: links keep their label, and
 * emphasis / code markers and backslash escapes are dropped, so the slug
 * matches the one computed from the rendered heading's text content.
 */
export function inlineText(markdown: string): string {
  // Code spans are literal: split them out so `source_to_concept_map` keeps its underscores.
  return markdown
    .split(/(`[^`]*`)/)
    .map((part, i) => (i % 2 === 1 ? part.slice(1, -1) : proseText(part)))
    .join('')
    .trim()
}

function proseText(markdown: string): string {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|\*)(?=\S)(.*?\S)\1/g, '$2')
    // Underscore emphasis only at word boundaries: GFM ignores intraword `_`.
    .replace(/(^|\W)(__|_)(?=\S)(.*?\S)\2(?=\W|$)/g, '$1$3')
    .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, '$1')
}

const FENCE = /^\s{0,3}(```|~~~)/

/** The lines of `markdown` that are not inside a fenced code block, with their index. */
function proseLines(markdown: string): { line: string; index: number }[] {
  const out: { line: string; index: number }[] = []
  let fence: string | null = null
  markdown.split('\n').forEach((line, index) => {
    const m = FENCE.exec(line)
    if (m) {
      if (fence === null) fence = m[1]
      else if (m[1] === fence) fence = null
      return
    }
    if (fence === null) out.push({ line, index })
  })
  return out
}

/**
 * The page title (the first `# ` heading) and the Markdown without it. The
 * page shows the title in its header, so the body must not repeat it.
 */
export function splitTitle(markdown: string): { title: string | null; body: string } {
  for (const { line, index } of proseLines(markdown)) {
    const m = /^#\s+(.+?)\s*#*\s*$/.exec(line)
    if (!m) continue
    const lines = markdown.split('\n')
    lines.splice(index, 1)
    return { title: inlineText(m[1]), body: lines.join('\n') }
  }
  return { title: null, body: markdown }
}

/** The ATX headings of the given levels, outside code blocks, in document order. */
export function extractHeadings(markdown: string, levels: readonly number[] = TOC_LEVELS): DocHeading[] {
  const headings: DocHeading[] = []
  const seen = new Map<string, number>()
  for (const { line, index } of proseLines(markdown)) {
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (!m || !levels.includes(m[1].length)) continue
    const text = inlineText(m[2])
    const base = headingId(text)
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    headings.push({ level: m[1].length, text, id: count === 0 ? base : `${base}-${count}`, line: index + 1 })
  }
  return headings
}

interface HastLike {
  type?: string
  value?: string
  children?: HastLike[]
}

/** Text content of a hast node (what a rendered heading reads), for its anchor id. */
export function hastText(node: HastLike | null | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.value ?? ''
  return (node.children ?? []).map(hastText).join('')
}
