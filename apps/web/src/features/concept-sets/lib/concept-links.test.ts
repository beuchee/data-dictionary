import { describe, expect, it } from 'vitest'
import { athenaUrl, fhirLookupUrl, isCustomConcept, isValidConcept, standardKind } from './concept-links'

describe('fhirLookupUrl', () => {
  it('maps the known vocabularies to their FHIR system', () => {
    expect(fhirLookupUrl('LOINC', '8867-4')).toBe(
      'https://tx.fhir.org/r4/CodeSystem/$lookup?system=http%3A%2F%2Floinc.org&code=8867-4',
    )
    expect(fhirLookupUrl('SNOMED', '364075005')).toContain('system=http%3A%2F%2Fsnomed.info%2Fsct&code=364075005')
    expect(fhirLookupUrl('ICD10CM', 'A00.0')).toContain('icd-10-cm')
    expect(fhirLookupUrl('RxNorm', '1191')).toContain('rxnorm')
    expect(fhirLookupUrl('UCUM', 'mmol/L')).toContain('code=mmol%2FL')
  })

  it('has no link for extensions, unknown vocabularies or a missing code', () => {
    expect(fhirLookupUrl('RxNorm Extension', 'OMOP123')).toBeNull()
    expect(fhirLookupUrl('OMOP Extension', 'X')).toBeNull()
    expect(fhirLookupUrl('INDICATE', '3D-CAM')).toBeNull()
    expect(fhirLookupUrl('LOINC', '')).toBeNull()
    expect(fhirLookupUrl(null, '1')).toBeNull()
  })

  it('does not read inherited object keys as vocabularies', () => {
    expect(fhirLookupUrl('constructor', '1')).toBeNull()
    expect(fhirLookupUrl('toString', '1')).toBeNull()
  })

  it('encodes codes that would break the query string', () => {
    expect(fhirLookupUrl('LOINC', 'a&b=c')).toContain('code=a%26b%3Dc')
  })
})

describe('athenaUrl / isCustomConcept', () => {
  it('links standard ids to Athena', () => {
    expect(athenaUrl(3027018)).toBe('https://athena.ohdsi.org/search-terms/terms/3027018')
  })

  it('has no Athena link for custom concepts (2 billion and up)', () => {
    expect(isCustomConcept(2_000_000_000)).toBe(true)
    expect(isCustomConcept(2_100_000_000)).toBe(true)
    expect(isCustomConcept(1_999_999_999)).toBe(false)
    expect(athenaUrl(2_100_000_000)).toBeNull()
  })
})

describe('standardKind', () => {
  it('reads standardConcept, with null and the legacy empty string as non-standard', () => {
    expect(standardKind('S')).toBe('standard')
    expect(standardKind('C')).toBe('classification')
    expect(standardKind(null)).toBe('non_standard')
    expect(standardKind('')).toBe('non_standard')
    expect(standardKind(undefined)).toBe('non_standard')
  })
})

describe('isValidConcept', () => {
  it('is valid without an invalid reason', () => {
    expect(isValidConcept(null)).toBe(true)
    expect(isValidConcept('')).toBe(true)
    expect(isValidConcept('V')).toBe(true)
    expect(isValidConcept('D')).toBe(false)
    expect(isValidConcept('U')).toBe(false)
  })
})
