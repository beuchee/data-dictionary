import { describe, expect, it } from 'vitest'
import {
  affineConversion,
  availableReferenceUnitIds,
  pickDefaultReferenceUnitId,
  referenceUnitOptions,
  unitLabelsFromOptions,
} from './units'
import type { RecommendedUnit, ResolvedConcept, UnitConversion } from '@data-dictionary/format'

const concept = (conceptId: number, domainId = 'Measurement', standardConcept: ResolvedConcept['standardConcept'] = 'S'): ResolvedConcept => ({
  conceptId, conceptName: '', domainId, vocabularyId: 'LOINC', conceptClassId: '', conceptCode: '', standardConcept,
})

const recommended = (conceptId: number, unitId: number, code = '', name = ''): RecommendedUnit => ({
  conceptId, conceptName: '', conceptCode: '', vocabularyId: 'LOINC', domainId: 'Measurement',
  recommendedUnitConceptId: unitId, recommendedUnitName: name, recommendedUnitCode: code, recommendedUnitVocabularyId: 'UCUM',
})

const conversion = (conceptId: number, source: number, target: number, extra: Partial<UnitConversion> = {}): UnitConversion => ({
  conceptId, conceptName: '', sourceUnitConceptId: source, sourceUnitCode: '', sourceUnitName: '', conversionFactor: 1,
  targetUnitConceptId: target, targetUnitCode: '', targetUnitName: '', ...extra,
})

describe('reference units', () => {
  it('collects recommended and conversion-target units of standard Measurement concepts only', () => {
    const resolved = [concept(1), concept(2, 'Observation'), concept(3, 'Measurement', null)]
    const ids = availableReferenceUnitIds(
      resolved,
      [recommended(1, 900), recommended(2, 800), recommended(3, 700)],
      [conversion(1, 900, 500), conversion(1, 500, 900), conversion(3, 1, 600)],
    )
    expect(ids).toEqual([500, 900])
  })

  it('has none for a set without Measurement concepts', () => {
    expect(availableReferenceUnitIds([concept(1, 'Drug')], [recommended(1, 9)], [])).toEqual([])
    expect(availableReferenceUnitIds([], [], [])).toEqual([])
  })

  it('labels options by code, then name, then id, and sorts them by code', () => {
    const options = referenceUnitOptions(
      [3, 2, 1],
      [recommended(10, 1, 'mmol/L', 'millimole per liter')],
      [conversion(10, 2, 1, { sourceUnitName: 'gram per liter', sourceUnitCode: 'g/L' })],
    )
    // Conversions give names only (as in v1), so unit 2 has no code and sorts by its id.
    expect(options.map((o) => [o.unitId, o.label])).toEqual([[2, 'gram per liter'], [3, 'concept_id=3'], [1, 'mmol/L']])
    expect(unitLabelsFromOptions(options)).toEqual({ 1: 'mmol/L', 2: 'gram per liter' })
  })

  it('prefers the vocabulary database for codes and names', () => {
    const options = referenceUnitOptions([1], [recommended(10, 1, 'mmol/L')], [], new Map([[1, { code: 'mmol/l', name: 'mmol' }]]))
    expect(options[0]).toMatchObject({ code: 'mmol/l', name: 'mmol', label: 'mmol/l' })
  })

  it('defaults to the most recommended unit, the lowest id on a tie, else the first candidate', () => {
    const resolved = [concept(1), concept(2), concept(3)]
    expect(pickDefaultReferenceUnitId([7, 8, 9], resolved, [recommended(1, 9), recommended(2, 9), recommended(3, 8)])).toBe(9)
    expect(pickDefaultReferenceUnitId([9, 8], resolved, [recommended(1, 9), recommended(2, 8)])).toBe(8)
    expect(pickDefaultReferenceUnitId([7, 8], resolved, [])).toBe(7)
    expect(pickDefaultReferenceUnitId([], resolved, [recommended(1, 9)])).toBeNull()
  })

  it('reads a conversion as factor and offset, refusing non-finite numbers', () => {
    expect(affineConversion(conversion(1, 1, 2, { conversionFactor: 1.8, offset: 32 }))).toEqual({ factor: 1.8, offset: 32 })
    expect(affineConversion(conversion(1, 1, 2, { conversionFactor: 2 }))).toEqual({ factor: 2, offset: 0 })
    expect(affineConversion(conversion(1, 1, 2, { conversionFactor: Number.POSITIVE_INFINITY }))).toBeNull()
  })
})
