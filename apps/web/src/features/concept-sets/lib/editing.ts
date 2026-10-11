// Ported from legacy/concept-sets.js (submitCreateCS, saveVersion, submitReview,
// defaultStatsTemplate, buildCategoryMap) as pure functions over a working copy.
import { parse, serialize, type ConceptSet, type ConceptSetTranslation, type Person, type Review, type ReviewStatus } from '@data-dictionary/format'
import { cloneContent } from '@/lib/export/provenance'
import type { ConceptSetSummary } from '@/lib/data'

// --- Metadata -----------------------------------------------------------------

/** The per-language fields of the metadata dialog. */
export interface MetadataFields {
  name: string
  category: string
  subcategory: string
  /** One line of plain text (the list's summary). */
  shortDescription: string
}

export const EMPTY_METADATA: MetadataFields = { name: '', category: '', subcategory: '', shortDescription: '' }

/** The dialog's fields for `lang` (empty when the set has no translation there). */
export function metadataFields(cs: ConceptSet | null, lang: string): MetadataFields {
  const tr = cs?.metadata?.translations?.[lang]
  return {
    name: tr?.name ?? '',
    category: tr?.category ?? '',
    subcategory: tr?.subcategory ?? '',
    shortDescription: tr?.shortDescription ?? '',
  }
}

/** One line: the short description is a table cell, never Markdown or multi-line. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * `cs` with the dialog's values written into `metadata.translations`, language
 * by language. A language left entirely empty that the set did not have stays
 * absent; empty fields are written as null (v1's convention). Other fields of a
 * translation (`longDescription`…) are kept.
 */
export function applyMetadata(cs: ConceptSet, values: Record<string, MetadataFields>): ConceptSet {
  const out = cloneContent(cs)
  const translations: Record<string, ConceptSetTranslation> = { ...(out.metadata.translations ?? {}) }
  for (const [lang, v] of Object.entries(values)) {
    const filled = [v.name, v.category, v.subcategory, v.shortDescription].some((s) => s.trim())
    if (!filled && !translations[lang]) continue
    const previous = translations[lang] ?? {}
    translations[lang] = {
      ...previous,
      name: v.name.trim() || null,
      category: v.category.trim() || null,
      subcategory: v.subcategory.trim() || null,
      shortDescription: oneLine(v.shortDescription) || null,
      longDescription: previous.longDescription ?? null,
    }
  }
  out.metadata = { ...out.metadata, translations }
  return out
}

export interface CategoryOptions {
  categories: string[]
  /** Category → its subcategories, both in the same language. */
  subcategories: Map<string, string[]>
}

/** The categories and subcategories existing sets use in `lang`, sorted, for the dialog's suggestions. */
export function categoryOptions(summaries: readonly ConceptSetSummary[], lang: string): CategoryOptions {
  const subcategories = new Map<string, Set<string>>()
  for (const s of summaries) {
    const tr = s.translations[lang]
    const category = tr?.category?.trim()
    if (!category) continue
    const subs = subcategories.get(category) ?? new Set<string>()
    const sub = tr?.subcategory?.trim()
    if (sub) subs.add(sub)
    subcategories.set(category, subs)
  }
  const sort = (values: Iterable<string>) => [...values].sort((a, b) => a.localeCompare(b))
  return {
    categories: sort(subcategories.keys()),
    subcategories: new Map([...subcategories].map(([k, v]) => [k, sort(v)])),
  }
}

/**
 * The most common `field` in `toLang` among the sets whose `field` in
 * `fromLang` is `value`: picking "Laboratory" in English suggests the French
 * category the existing sets pair it with. Null when no set says.
 */
export function counterpart(
  summaries: readonly ConceptSetSummary[],
  field: 'category' | 'subcategory',
  fromLang: string,
  toLang: string,
  value: string,
): string | null {
  const needle = value.trim()
  if (!needle) return null
  const counts = new Map<string, number>()
  for (const s of summaries) {
    if (s.translations[fromLang]?.[field]?.trim() !== needle) continue
    const other = s.translations[toLang]?.[field]?.trim()
    if (other) counts.set(other, (counts.get(other) ?? 0) + 1)
  }
  let best: string | null = null
  let bestCount = 0
  for (const [k, n] of counts) if (n > bestCount || (n === bestCount && best !== null && k < best)) [best, bestCount] = [k, n]
  return best
}

// --- New concept set -----------------------------------------------------------

export interface NewConceptSetInput {
  id: number
  values: Record<string, MetadataFields>
  /** Who creates it. */
  person: Person
  authorName: string
  organization: { name: string; url: string } | null
  repoUrl: string
  toolTag: string
  /** `YYYY-MM-DD`. */
  date: string
  uniqueId: string
}

/**
 * A new, empty concept set in the field order of `concept_set.example.json`:
 * version 1.0.0, status draft, this organization as creator and current owner,
 * no origin (created here), an empty expression for the concepts to come.
 */
export function newConceptSet(input: NewConceptSetInput): ConceptSet {
  const org = input.organization ?? { name: '', url: '' }
  const shell: ConceptSet = {
    id: input.id,
    name: '',
    description: null,
    version: '1.0.0',
    createdBy: input.authorName || null,
    createdDate: input.date,
    modifiedBy: input.authorName || null,
    modifiedDate: input.date,
    createdByTool: input.toolTag,
    expression: { items: [] },
    tags: [],
    metadata: {
      uniqueId: input.uniqueId,
      organization: { created: { ...org }, current: { ...org } },
      sourceRepo: input.repoUrl,
      reviewStatus: 'draft',
      origin: null,
      translations: {},
      createdByDetails: {
        firstName: input.person.firstName ?? '',
        lastName: input.person.lastName ?? '',
        affiliation: input.person.affiliation ?? '',
        profession: input.person.profession ?? '',
        orcid: input.person.orcid ?? '',
      },
      reviews: [],
      versions: [],
      distributionStats: null,
    },
  }
  const out = applyMetadata(shell, input.values)
  const en = out.metadata.translations.en
  out.name = en?.name ?? Object.values(out.metadata.translations).find((t) => t.name)?.name ?? ''
  out.description = en?.shortDescription ?? null
  return out
}

// --- Versions ------------------------------------------------------------------

export interface VersionBump {
  version: string
  /** `YYYY-MM-DD`. */
  date: string
  author: string
  message: string
}

/**
 * `cs` at a new version, recorded in `metadata.versions` as `{version, date,
 * author, message}`. Bumping again within the same draft (the working copy is
 * already past `baseVersion`) replaces the entry of that unpublished version
 * instead of stacking a second one.
 */
export function applyVersionBump(cs: ConceptSet, baseVersion: string | null, bump: VersionBump): ConceptSet {
  const out = cloneContent(cs)
  const versions = Array.isArray(out.metadata.versions) ? [...out.metadata.versions] : []
  const entry = { version: bump.version.trim(), date: bump.date, author: bump.author.trim(), message: bump.message.trim() }
  const last = versions[versions.length - 1]
  const unpublished = baseVersion !== null && out.version !== baseVersion && last?.version === out.version
  if (unpublished) versions[versions.length - 1] = entry
  else versions.push(entry)
  out.version = entry.version
  out.metadata = { ...out.metadata, versions }
  return out
}

// --- Reviews -------------------------------------------------------------------

export interface ReviewInput {
  /** null: a plain comment, stored with no `status` key at all (not a verdict). */
  status: ReviewStatus | null
  /** Markdown. */
  comments: string
  reviewer: Person
  /** ISO timestamp. */
  timestamp: string
}

/** `cs` with one more review of its current version, numbered after the existing ones. */
export function appendReview(cs: ConceptSet, input: ReviewInput): ConceptSet {
  const out = cloneContent(cs)
  const reviews = Array.isArray(out.metadata.reviews) ? out.metadata.reviews : []
  const maxId = reviews.reduce((max, r) => (typeof r.reviewId === 'number' && r.reviewId > max ? r.reviewId : max), 0)
  const review: Review = {
    reviewId: maxId + 1,
    reviewer: {
      firstName: input.reviewer.firstName ?? '',
      lastName: input.reviewer.lastName ?? '',
      affiliation: input.reviewer.affiliation ?? '',
      profession: input.reviewer.profession ?? '',
      orcid: input.reviewer.orcid ?? '',
    },
    reviewTimestamp: input.timestamp,
    comments: input.comments.trim(),
    version: cs.version || '1.0.0',
  }
  if (input.status) review.status = input.status
  out.metadata = { ...out.metadata, reviews: [...reviews, review] }
  return out
}

// --- Statistics ----------------------------------------------------------------

/** v1's `defaultStatsTemplate`: one "All patients" profile with every field empty. */
export const STATISTICS_TEMPLATE = {
  profiles: [
    {
      name_en: 'All patients',
      name_fr: 'Tous les patients',
      description_en: 'Default profile for all patients',
      description_fr: 'Profil par défaut pour tous les patients',
      data_types: [],
      numeric_data: { min: null, max: null, mean: null, median: null, sd: null, cv: null, p5: null, p25: null, p75: null, p95: null },
      histogram: [],
      categorical_data: [],
      measurement_frequency: { typical_interval: null },
    },
  ],
  default_profile_en: 'All patients',
  default_profile_fr: 'Tous les patients',
}

export function statisticsTemplateText(): string {
  return serialize(STATISTICS_TEMPLATE, { trailingNewline: false })
}

/** The Statistics editor's starting text: the set's statistics, else the template. */
export function statisticsEditorText(cs: ConceptSet): string {
  const stats = cs.metadata?.distributionStats
  return stats && typeof stats === 'object' && Object.keys(stats).length > 0
    ? serialize(stats, { trailingNewline: false })
    : statisticsTemplateText()
}

export type StatisticsParse = { ok: true; value: Record<string, unknown> | null } | { ok: false; error: string }

/** The editor's text as `distributionStats` (empty = null), number lexemes kept; an error for anything but an object. */
export function parseStatistics(text: string): StatisticsParse {
  if (!text.trim()) return { ok: true, value: null }
  try {
    const value = parse<unknown>(text)
    if (value === null) return { ok: true, value: null }
    if (typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'not_object' }
    return { ok: true, value: value as Record<string, unknown> }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** `cs` with `metadata.translations[lang].longDescription` set (empty = null). */
export function withLongDescription(cs: ConceptSet, lang: string, markdown: string): ConceptSet {
  const out = cloneContent(cs)
  const translations = { ...(out.metadata.translations ?? {}) }
  const previous = translations[lang]
  const value = markdown.trim() ? markdown.replace(/\s+$/, '') : null
  if (!previous && value === null) return out
  translations[lang] = previous ? { ...previous, longDescription: value } : { longDescription: value }
  out.metadata = { ...out.metadata, translations }
  return out
}
