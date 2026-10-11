import rawIndex from '@/content/docs/index.json'

/** A language-first label: `{ en: '…', fr: '…' }`. */
export type Localized = Readonly<Record<string, string>>

export interface DocSection {
  /** File name (`<id>.md`) and `?section=` value; v1's ids, kept so old links resolve. */
  id: string
  /** A lucide icon name, mapped to a component by the page. */
  icon: string
  title: Localized
}

export interface DocGroup {
  id: string
  title: Localized
  sections: DocSection[]
}

/** The sidebar, in order: `content/docs/index.json`. */
export const DOC_GROUPS: readonly DocGroup[] = rawIndex.groups

/** Every section, in reading order (the order prev / next follow). */
export function flattenSections(groups: readonly DocGroup[] = DOC_GROUPS): DocSection[] {
  return groups.flatMap((g) => g.sections)
}

export interface SectionResolution {
  /** The section to show. */
  id: string
  /** False when `?section=` named a section that does not exist (the first one is shown instead). */
  known: boolean
}

/**
 * The section a `?section=` value selects. Missing or empty → the first
 * section; unknown → the first section too, flagged so the page can fix the URL.
 * Matching is exact: ids are the v1 slugs (`concept-set-details`).
 */
export function resolveSection(param: string | null | undefined, sections: readonly DocSection[]): SectionResolution {
  const first = sections[0]?.id ?? ''
  const wanted = param?.trim() ?? ''
  if (!wanted) return { id: first, known: true }
  if (sections.some((s) => s.id === wanted)) return { id: wanted, known: true }
  return { id: first, known: false }
}

/** The sections before and after `id` in reading order. */
export function neighbours(
  id: string,
  sections: readonly DocSection[],
): { prev: DocSection | null; next: DocSection | null } {
  const i = sections.findIndex((s) => s.id === id)
  if (i < 0) return { prev: null, next: null }
  return { prev: sections[i - 1] ?? null, next: sections[i + 1] ?? null }
}

/** The label in `lang`, or null: no cross-language fallback, as everywhere in the dictionary. */
export function localized(label: Localized, lang: string): string | null {
  const value = label[lang]
  return value?.trim() ? value : null
}

/**
 * The section a link's `href` points to when it is a documentation link
 * (`?section=browsing`, `/documentation?section=browsing`, or v1's
 * `#/documentation?section=browsing`), else null.
 */
export function sectionFromHref(href: string | null | undefined): string | null {
  if (!href) return null
  const m = /^(?:#?\/documentation)?\?(.*)$/.exec(href.trim())
  if (!m) return null
  const query = m[1].split('#')[0]
  const value = new URLSearchParams(query).get('section')
  return value?.trim() ? value.trim() : null
}
