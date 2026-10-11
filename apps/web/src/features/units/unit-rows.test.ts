import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { RawNumber, parse, serialize, type RecommendedUnit, type UnitConversion } from '@data-dictionary/format'
import {
  buildConversionRow,
  buildRecommendedRow,
  conversionForm,
  convertValue,
  exportUnitsFile,
  formatConverted,
  formulaLabel,
  numberText,
  parseNumberInput,
  recommendedForm,
  removeRows,
  setConversionFactor,
  upsertRow,
  validateConversion,
  validateRecommended,
  type ConversionForm,
} from './unit-rows'
import { unitsFromPayload } from './units-source'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..')
const CONVERSIONS_TEXT = readFileSync(path.join(REPO, 'units/unit_conversions.json'), 'utf-8')

const row = (over: Partial<UnitConversion> = {}): UnitConversion => ({
  conceptId: 1,
  conceptName: 'Glucose',
  sourceUnitConceptId: 8636,
  sourceUnitCode: 'g/L',
  sourceUnitName: 'gram per liter',
  conversionFactor: 5.55,
  targetUnitConceptId: 8753,
  targetUnitCode: 'mmol/L',
  targetUnitName: 'millimole per liter',
  ...over,
})

const form = (over: Partial<ConversionForm> = {}): ConversionForm => ({
  concept: { conceptId: 1, conceptName: 'Glucose' },
  source: { conceptId: 8636, conceptName: 'gram per liter', conceptCode: 'g/L' },
  target: { conceptId: 8753, conceptName: 'millimole per liter', conceptCode: 'mmol/L' },
  factor: '5.55',
  offset: '',
  ...over,
})

describe('parseNumberInput', () => {
  it('keeps the typed lexeme when JavaScript would not print it back', () => {
    expect(parseNumberInput('1.0')).toEqual(new RawNumber('1.0'))
    expect(parseNumberInput('0.10')).toEqual(new RawNumber('0.10'))
    expect(parseNumberInput('2.5')).toBe(2.5)
    expect(parseNumberInput(' 3 ')).toBe(3)
    expect(parseNumberInput('-40')).toBe(-40)
    expect(parseNumberInput('1,5')).toBe(1.5)
  })

  it('refuses what is not a finite JSON number', () => {
    for (const bad of ['', 'abc', '1.', '.5', '1e999', 'NaN', 'Infinity', '0x10', '1 2', '--1']) {
      expect(parseNumberInput(bad), bad).toBeNull()
    }
  })

  it('numberText shows the lexeme', () => {
    expect(numberText(new RawNumber('1.0'))).toBe('1.0')
    expect(numberText(0.5)).toBe('0.5')
    expect(numberText(undefined)).toBe('')
  })
})

describe('conversion maths', () => {
  it('applies the affine formula', () => {
    expect(convertValue(10, { conversionFactor: 5.55 })).toBeCloseTo(55.5)
    // °C → °F
    expect(convertValue(100, { conversionFactor: 1.8, offset: 32 })).toBe(212)
    expect(convertValue(-40, { conversionFactor: 1.8, offset: 32 })).toBe(-40)
    expect(convertValue(3, { conversionFactor: new RawNumber('1.0') })).toBe(3)
    expect(convertValue(2, { conversionFactor: 10.929, offset: new RawNumber('-23.50') })).toBeCloseTo(-1.642)
  })

  it('formats results without float noise', () => {
    expect(formatConverted(0.1 + 0.2)).toBe('0.3')
    expect(formatConverted(1 / 3)).toBe('0.3333333333')
    expect(formatConverted(Number.NaN)).toBe('—')
  })

  it('labels the formula like v1', () => {
    expect(formulaLabel({ conversionFactor: 1.8, offset: 32 })).toBe('× 1.8 + 32')
    expect(formulaLabel({ conversionFactor: 10.929, offset: -23.5 })).toBe('× 10.929 − 23.5')
    expect(formulaLabel({ conversionFactor: new RawNumber('1.0') })).toBe('× 1')
  })
})

describe('validateConversion', () => {
  it('checks in v1 order', () => {
    expect(validateConversion(form({ concept: null }), [], null)).toBe('missing_concepts')
    expect(validateConversion(form({ factor: 'x' }), [], null)).toBe('invalid_factor')
    expect(validateConversion(form({ factor: '0' }), [], null)).toBe('factor_not_positive')
    expect(validateConversion(form({ factor: '-2' }), [], null)).toBe('factor_not_positive')
    expect(validateConversion(form({ offset: 'abc' }), [], null)).toBe('invalid_offset')
    expect(validateConversion(form({ target: form().source }), [], null)).toBe('same_units')
    expect(validateConversion(form(), [], null)).toBeNull()
  })

  it('refuses a duplicate (concept, source, target), except the row being edited', () => {
    const rows = [row(), row({ conceptId: 2 })]
    expect(validateConversion(form(), rows, null)).toBe('duplicate')
    expect(validateConversion(form(), rows, 0)).toBeNull()
    expect(validateConversion(form(), rows, 1)).toBe('duplicate')
  })
})

describe('buildConversionRow', () => {
  it('writes the file key order, offset right after the factor', () => {
    const built = buildConversionRow(form({ offset: '32' }))
    expect(Object.keys(built)).toEqual([
      'conceptId',
      'conceptName',
      'sourceUnitConceptId',
      'sourceUnitCode',
      'sourceUnitName',
      'conversionFactor',
      'offset',
      'targetUnitConceptId',
      'targetUnitCode',
      'targetUnitName',
    ])
    expect(built.offset).toBe(32)
  })

  it('drops a zero or empty offset', () => {
    expect('offset' in buildConversionRow(form({ offset: '0' }))).toBe(false)
    expect('offset' in buildConversionRow(form({ offset: '' }), row({ offset: 4 }))).toBe(false)
  })

  it('an untouched edit gives back the same bytes, raw lexemes and unknown keys included', () => {
    const existing = { ...row({ conversionFactor: new RawNumber('1.0'), offset: new RawNumber('-23.50') }), note: 'x' }
    const rebuilt = buildConversionRow(conversionForm(existing), existing)
    expect(serialize(rebuilt)).toBe(serialize(existing))
  })
})

describe('setConversionFactor', () => {
  it('replaces one row and keeps every other row object', () => {
    const rows = [row(), row({ conceptId: 2, conversionFactor: new RawNumber('1.0') })]
    const next = setConversionFactor(rows, 0, '2.5')
    expect(next?.[0].conversionFactor).toBe(2.5)
    expect(next?.[1]).toBe(rows[1])
  })

  it('refuses a non-positive or invalid value, and keeps an unchanged one', () => {
    const rows = [row({ conversionFactor: new RawNumber('1.0') })]
    expect(setConversionFactor(rows, 0, '0')).toBeNull()
    expect(setConversionFactor(rows, 0, 'abc')).toBeNull()
    expect(setConversionFactor(rows, 5, '2')).toBeNull()
    expect(setConversionFactor(rows, 0, '1')).toBe(rows)
  })
})

describe('the real unit_conversions.json', () => {
  it('editing one row leaves every other byte, `1.0` factors included', () => {
    expect(CONVERSIONS_TEXT).toContain('"conversionFactor": 1.0,')
    const rows = parse<UnitConversion[]>(CONVERSIONS_TEXT)
    expect(exportUnitsFile(rows, 'unit-conversions')).toBe(CONVERSIONS_TEXT)

    const index = rows.findIndex((r) => r.conversionFactor === 5.55062)
    const edited = setConversionFactor(rows, index, '5.5507')
    expect(edited).not.toBeNull()
    const out = exportUnitsFile(edited as UnitConversion[], 'unit-conversions')
    expect(out).toBe(CONVERSIONS_TEXT.replace('"conversionFactor": 5.55062,', '"conversionFactor": 5.5507,'))
    expect(out.match(/"conversionFactor": 1\.0,/g)?.length).toBe(CONVERSIONS_TEXT.match(/"conversionFactor": 1\.0,/g)?.length)
  })

  it('deleting a row and editing another through the dialog keeps the lexemes', () => {
    const rows = parse<UnitConversion[]>(CONVERSIONS_TEXT)
    const one = rows.findIndex((r) => r.conversionFactor instanceof RawNumber)
    const withOffset = rows.findIndex((r) => r.offset !== undefined)
    const edited = upsertRow(rows, buildConversionRow(conversionForm(rows[withOffset]), rows[withOffset]), withOffset)
    const out = exportUnitsFile(removeRows(edited, [0]), 'unit-conversions')
    const expected = exportUnitsFile(rows.slice(1), 'unit-conversions')
    expect(out).toBe(expected)
    expect(out).toContain(serialize(rows[one]).trimEnd().split('\n').join('\n  '))
  })

  it('the static payload keeps the lexemes too', () => {
    const payload = parse(`{"unitConversions":[{"conversionFactor":1.0}],"recommendedUnits":[]}`)
    expect(numberText(unitsFromPayload(payload, 'unit-conversions')[0].conversionFactor)).toBe('1.0')
    expect(unitsFromPayload(payload, 'recommended-units')).toEqual([])
    expect(unitsFromPayload(null, 'recommended-units')).toEqual([])
  })
})

describe('recommended units', () => {
  const ru: RecommendedUnit = {
    conceptId: 3,
    conceptName: 'Insulin',
    conceptCode: '93727-6',
    vocabularyId: 'LOINC',
    domainId: 'Measurement',
    recommendedUnitConceptId: 8729,
    recommendedUnitName: 'picomole per liter',
    recommendedUnitCode: 'pmol/L',
    recommendedUnitVocabularyId: 'UCUM',
  }

  it('validates and refuses duplicates', () => {
    expect(validateRecommended({ concept: null, unit: null }, [], null)).toBe('missing_concepts')
    expect(validateRecommended(recommendedForm(ru), [ru], null)).toBe('duplicate')
    expect(validateRecommended(recommendedForm(ru), [ru], 0)).toBeNull()
  })

  it('round-trips a row through its form', () => {
    expect(serialize(buildRecommendedRow(recommendedForm(ru), ru))).toBe(serialize(ru))
    expect(Object.keys(buildRecommendedRow(recommendedForm(ru)))).toEqual(Object.keys(ru))
  })

  it('upsert and remove', () => {
    const rows = [ru, { ...ru, conceptId: 4 }]
    expect(upsertRow(rows, { ...ru, conceptId: 9 }, null).map((r) => r.conceptId)).toEqual([3, 4, 9])
    expect(upsertRow(rows, { ...ru, conceptId: 9 }, 1).map((r) => r.conceptId)).toEqual([3, 9])
    expect(removeRows(rows, [0]).map((r) => r.conceptId)).toEqual([4])
    expect(removeRows(rows, [])).toEqual(rows)
  })
})
