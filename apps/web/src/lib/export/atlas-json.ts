// Ported from legacy/concept-sets.js (buildAtlasJSON); byte-identical to v1 (atlas-json.test.ts).
import type { ConceptSet } from '@data-dictionary/format'

/**
 * The set's expression in ATLAS's concept set format: uppercase concept keys,
 * `YYYYMMDD` dates, `INVALID_REASON` 'V' for valid. Printed like v1, without a
 * final newline.
 */
export function buildAtlasJson(cs: ConceptSet): string {
  const items = cs.expression?.items ?? []
  const atlasItems = items.map((item) => {
    const c = item.concept
    const sc = c.standardConcept
    return {
      concept: {
        CONCEPT_ID: c.conceptId,
        CONCEPT_NAME: c.conceptName,
        DOMAIN_ID: c.domainId,
        VOCABULARY_ID: c.vocabularyId,
        CONCEPT_CLASS_ID: c.conceptClassId,
        STANDARD_CONCEPT: sc || '',
        STANDARD_CONCEPT_CAPTION: sc === 'S' ? 'Standard' : sc === 'C' ? 'Classification' : 'Non-Standard',
        CONCEPT_CODE: c.conceptCode,
        VALID_START_DATE: (c.validStartDate || '19700101').replace(/-/g, ''),
        VALID_END_DATE: (c.validEndDate || '20991231').replace(/-/g, ''),
        INVALID_REASON: c.invalidReason || 'V',
        INVALID_REASON_CAPTION: c.invalidReasonCaption || 'Valid',
      },
      isExcluded: item.isExcluded || false,
      includeDescendants: item.includeDescendants || false,
      includeMapped: item.includeMapped || false,
    }
  })
  return JSON.stringify({ items: atlasItems }, null, 2)
}
