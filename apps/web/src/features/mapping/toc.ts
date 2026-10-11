import { foldAccents } from '@/lib/fold-accents'

export interface TocHeading {
  level: number
  text: string
  id: string
}

/** A heading's anchor id, as MarkdownRenderer derives it (accents folded, kebab-case). */
export function headingSlug(text: string): string {
  return foldAccents(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

/** A heading's text without its inline Markdown (emphasis, code, links, images). */
export function plainHeadingText(raw: string): string {
  return raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|\*|~~|`/g, '')
    .replace(/(^|\s)__?([^_]+?)__?(?=\s|$)/g, '$1$2')
    .replace(/\s+#+\s*$/, '')
    .trim()
}

/**
 * The ATX headings of a Markdown document at `levels` (the table of contents),
 * outside fenced code blocks. Ids are not de-duplicated, like the rendered
 * headings': two equal headings both lead to the first.
 */
export function extractHeadings(markdown: string, levels: readonly number[] = [2, 3]): TocHeading[] {
  const out: TocHeading[] = []
  let fence: string | null = null
  for (const line of markdown.split('\n')) {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1][0]
      if (fence === null) fence = marker
      else if (fence === marker) fence = null
      continue
    }
    if (fence !== null) continue
    const m = /^\s{0,3}(#{1,6})\s+(.+)$/.exec(line)
    if (!m || !levels.includes(m[1].length)) continue
    const text = plainHeadingText(m[2])
    if (!text) continue
    out.push({ level: m[1].length, text, id: headingSlug(text) })
  }
  return out
}

/**
 * Indices of the sections in view, as v1 highlighted them: section `i` runs
 * from heading `i` to heading `i + 1` (the last one to `contentBottom`), and is
 * active when it overlaps `[viewTop, viewBottom)`. All in one coordinate space.
 */
export function visibleSections(headingTops: readonly number[], contentBottom: number, viewTop: number, viewBottom: number): number[] {
  const active: number[] = []
  headingTops.forEach((top, i) => {
    const bottom = i + 1 < headingTops.length ? headingTops[i + 1] : contentBottom
    if (bottom > viewTop && top < viewBottom) active.push(i)
  })
  return active
}
