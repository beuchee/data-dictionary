// The concept set list: rows in one language, and its filters as URL state
// (shareable links, like v1's `#/concept-sets?category=A,B`).
import { REVIEW_STATUSES, type ReviewStatus } from '@data-dictionary/format'
import { fuzzyFilter } from '@/lib/fuzzy-search'
import type { ConceptSetSummary } from '@/lib/data'

export interface ConceptSetRow {
  id: number
  /** Empty when the set has no translation in this language: no cross-language fallback. */
  name: string
  category: string
  subcategory: string
  shortDescription: string
  reviewStatus: ReviewStatus | null
  version: string
  itemCount: number
  resolvedCount: number | null
  organization: string
  modifiedDate: string
}

export function toRow(summary: ConceptSetSummary, lang: string): ConceptSetRow {
  const t = Object.hasOwn(summary.translations, lang) ? summary.translations[lang] : undefined
  return {
    id: summary.id,
    name: t?.name ?? '',
    category: t?.category ?? '',
    subcategory: t?.subcategory ?? '',
    shortDescription: t?.shortDescription ?? '',
    reviewStatus: summary.reviewStatus,
    version: summary.version,
    itemCount: summary.itemCount,
    resolvedCount: summary.resolvedCount,
    organization: summary.organization?.current?.name ?? '',
    modifiedDate: summary.modifiedDate ?? '',
  }
}

export interface ListFilters {
  q: string
  categories: string[]
  subcategories: string[]
  /** null = the default view, every status but `deprecated` (as v1); [] = every status. */
  statuses: ReviewStatus[] | null
  organizations: string[]
  description: string
}

export const EMPTY_FILTERS: ListFilters = {
  q: '',
  categories: [],
  subcategories: [],
  statuses: null,
  organizations: [],
  description: '',
}

/** What the status filter shows as selected for the default view. */
export const DEFAULT_STATUSES: ReviewStatus[] = REVIEW_STATUSES.filter((s) => s !== 'deprecated')

const PARAM = {
  q: 'q',
  categories: 'category',
  subcategories: 'subcategory',
  statuses: 'status',
  organizations: 'org',
  description: 'description',
} as const

const splitList = (raw: string | null): string[] =>
  raw == null ? [] : raw.split(',').map((s) => s.trim()).filter(Boolean)

const isStatus = (s: string): s is ReviewStatus => (REVIEW_STATUSES as readonly string[]).includes(s)

export function parseListFilters(params: URLSearchParams): ListFilters {
  const status = params.get(PARAM.statuses)
  return {
    q: params.get(PARAM.q) ?? '',
    categories: splitList(params.get(PARAM.categories)),
    subcategories: splitList(params.get(PARAM.subcategories)),
    statuses: status == null ? null : splitList(status).filter(isStatus),
    organizations: splitList(params.get(PARAM.organizations)),
    description: params.get(PARAM.description) ?? '',
  }
}

/**
 * The URL query for `filters`; empty filters are left out. Values are joined
 * with commas, as v1 did for categories: a label holding a comma cannot be
 * expressed (none does today).
 */
export function writeListFilters(filters: ListFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.q.trim()) params.set(PARAM.q, filters.q)
  if (filters.categories.length) params.set(PARAM.categories, filters.categories.join(','))
  if (filters.subcategories.length) params.set(PARAM.subcategories, filters.subcategories.join(','))
  if (filters.statuses) params.set(PARAM.statuses, filters.statuses.join(','))
  if (filters.organizations.length) params.set(PARAM.organizations, filters.organizations.join(','))
  if (filters.description.trim()) params.set(PARAM.description, filters.description)
  return params
}

/** The values the status filter shows as checked. */
export function selectedStatuses(filters: ListFilters): ReviewStatus[] {
  return filters.statuses ?? DEFAULT_STATUSES
}

const isOther = (c: string) => ['other', 'autres', 'autre'].includes(c.toLowerCase())

/** Alphabetical, with "Other" / "Autres" last (as v1). */
export function sortCategories(categories: Iterable<string>): string[] {
  return [...categories].sort((a, b) => {
    const ao = isOther(a)
    const bo = isOther(b)
    if (ao !== bo) return ao ? 1 : -1
    return a.localeCompare(b)
  })
}

/** One badge per non-empty category, with the number of sets in it. */
export function categoryCounts(rows: ConceptSetRow[]): { category: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const r of rows) if (r.category) counts.set(r.category, (counts.get(r.category) ?? 0) + 1)
  return sortCategories(counts.keys()).map((category) => ({ category, count: counts.get(category)! }))
}

/** Subcategories offered by the filter: within the selected categories, when any. */
export function subcategoryOptions(rows: ConceptSetRow[], categories: string[]): string[] {
  const inScope = categories.length ? rows.filter((r) => categories.includes(r.category)) : rows
  return [...new Set(inScope.map((r) => r.subcategory).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

/**
 * The rows the list shows: every filter, then the fuzzy search on the name
 * (an all-digit query also finds the id), best match first.
 */
export function applyListFilters(rows: ConceptSetRow[], filters: ListFilters): ConceptSetRow[] {
  const { categories, organizations } = filters
  // A subcategory left over from a category no longer selected would hide everything.
  const offered = new Set(subcategoryOptions(rows, categories))
  const subcategories = filters.subcategories.filter((s) => offered.has(s))
  const description = filters.description.trim().toLowerCase()
  const filtered = rows.filter((r) => {
    if (categories.length && !categories.includes(r.category)) return false
    if (subcategories.length && !subcategories.includes(r.subcategory)) return false
    if (organizations.length && !organizations.includes(r.organization)) return false
    if (filters.statuses === null) {
      if (r.reviewStatus === 'deprecated') return false
    } else if (filters.statuses.length && !(r.reviewStatus && filters.statuses.includes(r.reviewStatus))) {
      return false
    }
    if (description && !r.shortDescription.toLowerCase().includes(description)) return false
    return true
  })
  const q = filters.q.trim()
  if (!q) return filtered
  return fuzzyFilter(filtered, q, (r) => (/^\d+$/.test(q) && String(r.id) === q ? [q] : [r.name]))
}
