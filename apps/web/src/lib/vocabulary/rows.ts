/** Query rows (snake_case, as DuckDB returns them) → the API's camelCase shapes.
 *  Twin of `concept_from_row` in apps/api/app/services/vocabulary_queries.py. */
import type { StandardConcept } from '@data-dictionary/format'
import type { AncestorCandidate, ConceptSynonym, HierarchyNode, OmopConcept, RelatedConcept } from './types'

export type Row = Record<string, unknown>

/** DuckDB-WASM hands BIGINT back as bigint. */
export function num(value: unknown): number {
  return Number(value)
}

function str(value: unknown): string {
  return value == null ? '' : String(value)
}

function strOrNull(value: unknown): string | null {
  return value == null || value === '' ? null : String(value)
}

export function conceptFromRow(r: Row): OmopConcept {
  return {
    conceptId: num(r.concept_id),
    conceptName: str(r.concept_name),
    domainId: str(r.domain_id),
    vocabularyId: str(r.vocabulary_id),
    conceptClassId: str(r.concept_class_id),
    standardConcept: strOrNull(r.standard_concept) as StandardConcept,
    conceptCode: str(r.concept_code),
    validStartDate: strOrNull(r.valid_start_date),
    validEndDate: strOrNull(r.valid_end_date),
    invalidReason: strOrNull(r.invalid_reason),
  }
}

export function relatedFromRow(r: Row): RelatedConcept {
  return { relationshipId: str(r.relationship_id), relationshipName: strOrNull(r.relationship_name), ...conceptFromRow(r) }
}

export function synonymFromRow(r: Row): ConceptSynonym {
  return {
    synonymName: str(r.concept_synonym_name),
    languageConceptId: r.language_concept_id == null ? null : num(r.language_concept_id),
    languageName: strOrNull(r.language_name),
  }
}

export function nodeFromRow(r: Row): HierarchyNode {
  return { ...conceptFromRow(r), hierarchyLevel: num(r.hierarchy_level) }
}

export function candidateFromRow(r: Row): AncestorCandidate {
  return { ...conceptFromRow(r), coveredCount: num(r.covered_count), minDepth: num(r.min_depth) }
}
