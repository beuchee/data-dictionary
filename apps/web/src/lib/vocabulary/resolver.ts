/**
 * Concept set resolution, live: port of the repo's `resolve.py` (same
 * algorithm, same output). Twin of `apps/api/app/services/resolver.py`; both
 * are checked against `apps/api/tests/fixtures/vocab/resolve-cases.json`,
 * itself produced by resolve.py.
 *
 * 1. Split the items into included and excluded.
 * 2. Expand each side: the items' own ids, plus the descendants of those with
 *    `includeDescendants`, plus what those with `includeMapped` map to or from
 *    (`Maps to` / `Mapped from`). Mapping applies to the item, not to its descendants.
 * 3. Resolved = included − excluded.
 * 4. Details from `concept`; a custom concept (id >= 2 100 000 000) takes them
 *    from the expression; an id the vocabulary lacks is dropped. Sorted by id.
 */
import type { ExpressionItem, ResolvedConcept, StandardConcept } from '@data-dictionary/format'
import { num, type Row } from './rows'
import { conceptId, descendantIds, mappedIds, resolvedDetails, type HierarchyMode, type SqlQuery } from './sql'
import type { VocabularyVersion } from './types'

export const CUSTOM_CONCEPT_BASE = 2_100_000_000

/** Where the expansion steps read the vocabulary. */
export interface ResolutionLookup {
  descendants(ids: number[]): Promise<number[]>
  mapped(ids: number[]): Promise<number[]>
  details(ids: number[]): Promise<ResolvedConcept[]>
}

/** An expression item as stored: loosely typed, since it comes from a file or an editor. */
type LooseItem = Pick<ExpressionItem, 'concept'> & Partial<Omit<ExpressionItem, 'concept'>>

const itemId = (item: LooseItem) => conceptId(item.concept?.conceptId)

async function expand(items: readonly LooseItem[], lookup: ResolutionLookup): Promise<Set<number>> {
  const ids = new Set(items.map(itemId))
  const desc = [...new Set(items.filter((i) => i.includeDescendants).map(itemId))]
  if (desc.length) for (const id of await lookup.descendants(desc)) ids.add(id)
  const mapped = [...new Set(items.filter((i) => i.includeMapped).map(itemId))]
  if (mapped.length) for (const id of await lookup.mapped(mapped)) ids.add(id)
  return ids
}

/** Same as Python's `dict.get(key, default)`: a present null stays null. */
function field<T>(concept: Record<string, unknown>, key: string, fallback: T): T {
  return (key in concept ? concept[key] : fallback) as T
}

export async function resolveItems(items: readonly LooseItem[] | null | undefined, lookup: ResolutionLookup): Promise<ResolvedConcept[]> {
  const all = items ?? []
  const included = all.filter((i) => !i.isExcluded)
  const excluded = all.filter((i) => i.isExcluded)
  if (!included.length) return []
  const resolved = await expand(included, lookup)
  if (excluded.length) for (const id of await expand(excluded, lookup)) resolved.delete(id)
  if (!resolved.size) return []

  const dbIds = [...resolved].filter((id) => id < CUSTOM_CONCEPT_BASE)
  const remaining = new Set([...resolved].filter((id) => id >= CUSTOM_CONCEPT_BASE))
  const result: ResolvedConcept[] = dbIds.length ? await lookup.details(dbIds) : []
  for (const item of [...included, ...excluded]) {
    const c = (item.concept ?? {}) as Record<string, unknown>
    const id = c.conceptId as number
    if (!remaining.has(id)) continue
    remaining.delete(id)
    result.push({
      conceptId: id,
      conceptName: field(c, 'conceptName', ''),
      vocabularyId: field(c, 'vocabularyId', ''),
      domainId: field(c, 'domainId', ''),
      conceptClassId: field(c, 'conceptClassId', ''),
      conceptCode: field(c, 'conceptCode', ''),
      standardConcept: field<StandardConcept>(c, 'standardConcept', null),
    })
  }
  return result.sort((a, b) => a.conceptId - b.conceptId)
}

/** A lookup running the shared SQL builders through `run`. */
export function sqlLookup(run: (query: SqlQuery) => Promise<Row[]>, mode: HierarchyMode): ResolutionLookup {
  const ids = async (query: SqlQuery) => (await run(query)).map((r) => num(r.concept_id))
  return {
    descendants: (list) => ids(descendantIds(list, mode)),
    mapped: (list) => ids(mappedIds(list)),
    details: async (list) =>
      (await run(resolvedDetails(list))).map((r) => ({
        conceptId: num(r.concept_id),
        conceptName: r.concept_name as string,
        vocabularyId: r.vocabulary_id as string,
        domainId: r.domain_id as string,
        conceptClassId: r.concept_class_id as string,
        conceptCode: r.concept_code as string,
        standardConcept: (r.standard_concept ?? null) as StandardConcept,
      })),
  }
}

/** Rows of `vocabularyVersions()` → `{release, <vocabularyId>: <version>}`, or null when empty. */
export function versionFromRows(rows: readonly Row[]): VocabularyVersion | null {
  if (!rows.length) return null
  const version: VocabularyVersion = {}
  for (const r of rows) {
    const id = String(r.vocabulary_id)
    version[id === 'None' ? 'release' : id] = r.vocabulary_version == null ? null : String(r.vocabulary_version)
  }
  return version
}

/** The release plus the versions of the vocabularies the concepts use, as
 *  resolve.py writes into concept_sets_resolved/{id}.json. */
export function stampVersion(version: VocabularyVersion | null, concepts: readonly ResolvedConcept[]): VocabularyVersion | null {
  if (!version) return null
  const out: VocabularyVersion = { release: version.release ?? null }
  const used = [...new Set(concepts.map((c) => c.vocabularyId).filter(Boolean))].sort()
  for (const id of used) if (id in version) out[id] = version[id]
  return out
}
