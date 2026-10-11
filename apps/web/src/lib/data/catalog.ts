// Twin of apps/api/app/services/content_store.py (concept_set_summary, normalize_organization,
// filter_resolved, version_history): the static source must return what the API returns.
import type { OrganizationRef } from '@data-dictionary/format'
import type {
  ConceptSet,
  ConceptSetSummary,
  ConceptSetSummaryTranslation,
  CustomConceptUse,
  ResolvedConcept,
  ResolvedConceptSet,
  ResolvedPage,
  ResolvedQuery,
  VersionInfo,
} from './types'

type Loose = Record<string, unknown>

const isObject = (v: unknown): v is Loose => typeof v === 'object' && v !== null && !Array.isArray(v)

/** `{created, current}`; the legacy flat `{name, url}` stands for both. */
export function normalizeOrganization(org: unknown): ConceptSetSummary['organization'] {
  if (!isObject(org)) return null
  if ('created' in org || 'current' in org) {
    const created = (org.created ?? null) as OrganizationRef | null
    return { created, current: ((org.current as OrganizationRef | null | undefined) || created) ?? null }
  }
  const flat = org as OrganizationRef
  return { created: flat, current: flat }
}

const SUMMARY_KEYS = ['name', 'category', 'subcategory', 'shortDescription'] as const

export function conceptSetSummary(cs: ConceptSet, resolvedCount: number | null): ConceptSetSummary {
  const metadata: Loose = isObject(cs.metadata) ? cs.metadata : {}
  const translations: Loose = isObject(metadata.translations) ? metadata.translations : {}
  const items = isObject(cs.expression) ? cs.expression.items : undefined
  const summaryTranslations: Record<string, ConceptSetSummaryTranslation> = {}
  for (const [lang, t] of Object.entries(translations)) {
    if (!isObject(t)) continue
    const out: Loose = {}
    for (const key of SUMMARY_KEYS) out[key] = t[key] ?? null
    summaryTranslations[lang] = out as ConceptSetSummaryTranslation
  }
  return {
    id: cs.id,
    version: cs.version,
    uniqueId: (metadata.uniqueId as string | undefined) ?? null,
    translations: summaryTranslations,
    reviewStatus: (metadata.reviewStatus as ConceptSetSummary['reviewStatus'] | undefined) ?? null,
    organization: normalizeOrganization(metadata.organization),
    itemCount: Array.isArray(items) ? items.length : 0,
    resolvedCount,
    modifiedDate: cs.modifiedDate ?? null,
    modifiedBy: cs.modifiedBy ?? null,
  }
}

/** Concepts whose id, name, code or vocabulary contains `search` (case-insensitive). */
export function filterResolved(concepts: ResolvedConcept[], search: string | undefined): ResolvedConcept[] {
  const needle = (search ?? '').trim().toLowerCase()
  if (!needle) return concepts
  return concepts.filter((c) =>
    [c.conceptId, c.conceptName, c.conceptCode, c.vocabularyId]
      .map((v) => (v == null ? '' : String(v)))
      .join(' ')
      .toLowerCase()
      .includes(needle),
  )
}

/** The page `GET /concept-sets/{id}/resolved` would return for `query`. */
export function pageResolved(
  resolved: Pick<ResolvedConceptSet, 'resolvedConcepts' | 'vocabularyVersion'>,
  conceptSetId: number,
  version: string | null,
  query: ResolvedQuery = {},
): ResolvedPage {
  const concepts = filterResolved(resolved.resolvedConcepts ?? [], query.search)
  const offset = Math.max(0, query.offset ?? 0)
  const limit = query.limit ?? null
  return {
    conceptSetId,
    version,
    vocabularyVersion: resolved.vocabularyVersion ?? null,
    total: concepts.length,
    offset,
    limit,
    resolvedConcepts: limit === null ? concepts.slice(offset) : concepts.slice(offset, offset + limit),
  }
}

/** Semver-ish ordering: numeric parts compare as numbers, a pre-release before its release. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const dash = v.indexOf('-')
    const core = (dash === -1 ? v : v.slice(0, dash)).split('+')[0]
    const pre = dash === -1 ? '' : v.slice(dash + 1)
    return { parts: core.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : -1)), pre }
  }
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < Math.max(pa.parts.length, pb.parts.length); i++) {
    const x = pa.parts[i]
    const y = pb.parts[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x !== y) return x - y
  }
  if (pa.pre === pb.pre) return 0
  if (!pa.pre) return 1
  if (!pb.pre) return -1
  return pa.pre < pb.pre ? -1 : 1
}

/** Every known version of a concept set, newest first: indexed in git, listed in its metadata, current. */
export function versionHistory(
  cs: ConceptSet | null | undefined,
  indexEntry: Record<string, string> | null | undefined,
): VersionInfo[] {
  const current = cs?.version ?? null
  const metadata: Loose = isObject(cs?.metadata) ? (cs.metadata as Loose) : {}
  const entries = new Map<string, Loose>()
  for (const e of Array.isArray(metadata.versions) ? metadata.versions : []) {
    if (isObject(e) && typeof e.version === 'string') entries.set(e.version, e)
  }
  const index = indexEntry ?? {}
  const versions = new Set([...Object.keys(index), ...entries.keys(), ...(current ? [current] : [])])
  return [...versions]
    .sort((a, b) => compareVersions(b, a))
    .map((version) => {
      const meta = entries.get(version) ?? {}
      return {
        version,
        commit: index[version] ?? null,
        isCurrent: version === current,
        date: (meta.date as string | undefined) ?? null,
        author: (meta.author as string | undefined) ?? null,
        message: (meta.message as string | undefined) ?? null,
      }
    })
}

/** Custom concepts start here (resolve.py's rule). */
const CUSTOM_CONCEPT_BASE = 2_100_000_000
const CUSTOM_FIELDS = ['conceptName', 'domainId', 'vocabularyId', 'conceptClassId', 'conceptCode'] as const

/**
 * The custom concepts `conceptSets` use, one per id (its first definition, by
 * set id), with the sets using it. Twin of `custom_concepts` in
 * apps/api/app/api/v1/routes/concept_sets.py.
 */
export function customConcepts(conceptSets: readonly ConceptSet[]): CustomConceptUse[] {
  const found = new Map<number, CustomConceptUse>()
  for (const cs of [...conceptSets].sort((a, b) => a.id - b.id)) {
    const items = isObject(cs.expression) && Array.isArray(cs.expression.items) ? cs.expression.items : []
    for (const item of items) {
      const concept = isObject(item) && isObject(item.concept) ? item.concept : null
      const id = concept?.conceptId
      if (typeof id !== 'number' || !Number.isInteger(id) || id < CUSTOM_CONCEPT_BASE) continue
      let entry = found.get(id)
      if (!entry) {
        entry = { conceptId: id, conceptName: null, domainId: null, vocabularyId: null, conceptClassId: null, conceptCode: null, conceptSetIds: [] }
        for (const k of CUSTOM_FIELDS) entry[k] = (concept?.[k] as string | null | undefined) ?? null
        found.set(id, entry)
      }
      if (!entry.conceptSetIds.includes(cs.id)) entry.conceptSetIds.push(cs.id)
    }
  }
  return [...found.values()].sort((a, b) => a.conceptId - b.conceptId)
}
