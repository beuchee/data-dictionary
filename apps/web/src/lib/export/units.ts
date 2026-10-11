// Ported from legacy/concept-sets.js (getSqlExportConcepts, getAvailableReferenceUnits,
// showSqlExportPreview → finishWithMaps / renderOptions, pickDefaultRefUnitId).
// Tested byte for byte against v1 in units.test.ts and omop-sql.test.ts.
import { toNumber, type RecommendedUnit, type ResolvedConcept, type UnitConversion } from '@data-dictionary/format'

/** A unit as the vocabulary DB knows it (`concept_code`, `concept_name`). */
export interface UnitVocabEntry {
  code: string
  name: string
}

/** One entry of the reference unit picker. */
export interface UnitOption {
  unitId: number
  /** UCUM code, '' when unknown. */
  code: string
  /** Long name, '' when unknown. */
  name: string
  /** What the picker shows: code, else name, else `concept_id=<id>`. */
  label: string
}

/** The concepts an SQL export queries: the standard ones of the resolved list. */
export function sqlExportConcepts(resolved: readonly ResolvedConcept[]): ResolvedConcept[] {
  return resolved.filter((c) => c.standardConcept === 'S')
}

function measurementConceptIds(resolved: readonly ResolvedConcept[]): Set<number> {
  return new Set(sqlExportConcepts(resolved).filter((c) => (c.domainId || '') === 'Measurement').map((c) => c.conceptId))
}

/**
 * Candidate reference units of a set: every recommended unit of its standard
 * Measurement concepts, plus every unit some conversion of those concepts
 * targets. Ascending ids (v1 collected them as integer object keys).
 */
export function availableReferenceUnitIds(
  resolved: readonly ResolvedConcept[],
  recommendedUnits: readonly RecommendedUnit[],
  unitConversions: readonly UnitConversion[],
): number[] {
  const ids = measurementConceptIds(resolved)
  if (ids.size === 0) return []
  const units = new Set<number>()
  for (const ru of recommendedUnits) {
    if (ids.has(ru.conceptId) && ru.recommendedUnitConceptId) units.add(ru.recommendedUnitConceptId)
  }
  for (const conv of unitConversions) {
    if (ids.has(conv.conceptId) && conv.targetUnitConceptId) units.add(conv.targetUnitConceptId)
  }
  return [...units].filter((id) => Number.isSafeInteger(id) && id >= 0).sort((a, b) => a - b)
}

/**
 * The picker entries for `unitIds`, sorted by code (then id) like v1. Codes and
 * names come from the vocabulary DB when given, then from the recommended units
 * (code and name), then from the conversions (name only, as in v1).
 */
export function referenceUnitOptions(
  unitIds: readonly number[],
  recommendedUnits: readonly RecommendedUnit[],
  unitConversions: readonly UnitConversion[],
  vocabulary?: ReadonlyMap<number, UnitVocabEntry>,
): UnitOption[] {
  const codes = new Map<number, string>()
  const names = new Map<number, string>()
  for (const [id, v] of vocabulary ?? []) {
    if (v.code) codes.set(id, v.code)
    if (v.name) names.set(id, v.name)
  }
  for (const ru of recommendedUnits) {
    const id = ru.recommendedUnitConceptId
    if (!id) continue
    if (!codes.get(id) && ru.recommendedUnitCode) codes.set(id, ru.recommendedUnitCode)
    if (!names.get(id) && ru.recommendedUnitName) names.set(id, ru.recommendedUnitName)
  }
  for (const conv of unitConversions) {
    if (conv.sourceUnitConceptId && !names.get(conv.sourceUnitConceptId) && conv.sourceUnitName) {
      names.set(conv.sourceUnitConceptId, conv.sourceUnitName)
    }
    if (conv.targetUnitConceptId && !names.get(conv.targetUnitConceptId) && conv.targetUnitName) {
      names.set(conv.targetUnitConceptId, conv.targetUnitName)
    }
  }
  const options = unitIds.map((unitId) => {
    const code = codes.get(unitId) ?? ''
    const name = names.get(unitId) ?? ''
    return { unitId, code, name, label: code || name || `concept_id=${unitId}` }
  })
  const sortKey = (o: UnitOption) => (o.code || String(o.unitId)).toLowerCase()
  return options.sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
}

/** Unit labels for the SQL comments (`mg/dL`), as the picker knows them. */
export function unitLabelsFromOptions(options: readonly UnitOption[]): Record<number, string> {
  const labels: Record<number, string> = {}
  for (const o of options) {
    const label = o.code || o.name
    if (label) labels[o.unitId] = label
  }
  return labels
}

/**
 * The reference unit preselected in the picker: the unit most often recommended
 * for the set's standard Measurement concepts (ties: the lowest id), else the
 * first candidate. `candidateIds` in picker order. null when there is none.
 */
export function pickDefaultReferenceUnitId(
  candidateIds: readonly number[],
  resolved: readonly ResolvedConcept[],
  recommendedUnits: readonly RecommendedUnit[],
): number | null {
  if (candidateIds.length === 0) return null
  const candidates = new Set(candidateIds)
  const ids = measurementConceptIds(resolved)
  const counts = new Map<number, number>()
  for (const ru of recommendedUnits) {
    if (ids.has(ru.conceptId) && candidates.has(ru.recommendedUnitConceptId)) {
      counts.set(ru.recommendedUnitConceptId, (counts.get(ru.recommendedUnitConceptId) ?? 0) + 1)
    }
  }
  let best: number | null = null
  let bestCount = -1
  // Ascending ids, so a tie keeps the lowest one (v1 walked integer object keys).
  for (const [unitId, count] of [...counts].sort((a, b) => a[0] - b[0])) {
    if (count > bestCount) {
      best = unitId
      bestCount = count
    }
  }
  return best || candidateIds[0]
}

/** One conversion row: target = factor × source + offset. */
export interface AffineConversion {
  factor: number
  offset: number
}

/** A conversion row's numbers, or null when they are not finite. */
export function affineConversion(conv: UnitConversion): AffineConversion | null {
  const factor = toNumber(conv.conversionFactor)
  const offset = conv.offset === undefined || conv.offset === null ? 0 : toNumber(conv.offset)
  if (!Number.isFinite(factor) || !Number.isFinite(offset)) return null
  return { factor, offset }
}
