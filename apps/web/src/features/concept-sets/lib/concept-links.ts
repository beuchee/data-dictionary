// Ported from legacy/concept-sets.js (buildFhirUrl, showResolvedConceptDetail).

/** OMOP reserves ids from 2 000 000 000 for local (custom) concepts: not in Athena. */
export const CUSTOM_CONCEPT_ID_MIN = 2_000_000_000

export function isCustomConcept(conceptId: number | string): boolean {
  return Number(conceptId) >= CUSTOM_CONCEPT_ID_MIN
}

/** The concept's Athena page, or null for a custom concept. */
export function athenaUrl(conceptId: number | string): string | null {
  return isCustomConcept(conceptId) ? null : `https://athena.ohdsi.org/search-terms/terms/${conceptId}`
}

/** OMOP vocabulary_id → FHIR code system URI. */
export const FHIR_SYSTEMS: Readonly<Record<string, string>> = {
  SNOMED: 'http://snomed.info/sct',
  LOINC: 'http://loinc.org',
  ICD10: 'http://hl7.org/fhir/sid/icd-10',
  ICD10CM: 'http://hl7.org/fhir/sid/icd-10-cm',
  UCUM: 'http://unitsofmeasure.org',
  RxNorm: 'http://www.nlm.nih.gov/research/umls/rxnorm',
}

/** A `CodeSystem/$lookup` on tx.fhir.org, or null when the vocabulary has no FHIR system (OMOP/RxNorm Extension…). */
export function fhirLookupUrl(vocabularyId: string | null | undefined, conceptCode: string | null | undefined): string | null {
  if (!vocabularyId || !conceptCode) return null
  const system = Object.hasOwn(FHIR_SYSTEMS, vocabularyId) ? FHIR_SYSTEMS[vocabularyId] : undefined
  if (!system) return null
  return `https://tx.fhir.org/r4/CodeSystem/$lookup?system=${encodeURIComponent(system)}&code=${encodeURIComponent(conceptCode)}`
}

export type StandardKind = 'standard' | 'classification' | 'non_standard'

/** `standardConcept` drives the badge (not the caption): 'S', 'C', anything else (null, '') is non-standard. */
export function standardKind(standardConcept: string | null | undefined): StandardKind {
  if (standardConcept === 'S') return 'standard'
  if (standardConcept === 'C') return 'classification'
  return 'non_standard'
}

/** Valid when `invalidReason` is empty (v1 also read the 'V' spelling as valid). */
export function isValidConcept(invalidReason: string | null | undefined): boolean {
  return !invalidReason || invalidReason === 'V'
}
