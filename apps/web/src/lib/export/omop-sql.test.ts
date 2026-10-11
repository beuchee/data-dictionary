import { describe, expect, it } from 'vitest'
import { buildOmopSql, domainTable, sqlComment, type OmopSqlOptions } from './omop-sql'
import {
  availableReferenceUnitIds,
  pickDefaultReferenceUnitId,
  referenceUnitOptions,
  unitLabelsFromOptions,
} from './units'
import * as v1 from './v1-fixtures'
import type { ConceptSet, ResolvedConcept, UnitConversion } from '@data-dictionary/format'

/** What the v2 dialog does: picker options from the units files, then the SQL. */
function sqlLikeTheDialog(c: v1.SqlCase) {
  const cs = v1.conceptSet(c.conceptSetId)
  const resolved = v1.resolved(c.conceptSetId)
  const options = referenceUnitOptions(
    availableReferenceUnitIds(resolved, v1.recommendedUnits, v1.unitConversions),
    v1.recommendedUnits,
    v1.unitConversions,
  )
  const defaultUnit = pickDefaultReferenceUnitId(options.map((o) => o.unitId), resolved, v1.recommendedUnits)
  const sql = buildOmopSql({
    conceptSet: cs,
    resolved,
    unitConversions: v1.unitConversions,
    recommendedUnits: v1.recommendedUnits,
    referenceUnitId: c.referenceUnitId,
    dropOtherUnits: c.dropOtherUnits,
    unitLabels: unitLabelsFromOptions(options),
    lang: c.lang,
    permalink: v1.v1Permalink(cs),
    toolTag: v1.cases.toolTag,
    date: v1.cases.date,
  })
  return { options, defaultUnit, sql }
}

describe('OMOP SQL: parity with v1', () => {
  it('covers the cases v1 is known for', () => {
    const ids = new Set(v1.cases.sql.map((c) => c.conceptSetId))
    for (const id of [155, 184, 330, 318, 305, 37, 17, 99998]) expect(ids).toContain(id)
    expect(v1.cases.sql.some((c) => c.dropOtherUnits)).toBe(true)
    expect(v1.cases.sql.some((c) => c.referenceUnitId === null && c.unitOptions.length > 0)).toBe(true)
  })

  it.each(v1.cases.sql.map((c) => [c.file, c] as const))('%s', (_, c) => {
    const { options, defaultUnit, sql } = sqlLikeTheDialog(c)
    expect(options.map((o) => ({ unitId: o.unitId, label: o.label }))).toEqual(c.unitOptions)
    if (c.isDefault) expect(defaultUnit).toBe(c.referenceUnitId)
    expect(sql).toBe(v1.readGolden(c.file))
  })
})

const measurement = (conceptId: number, conceptName = `Concept ${conceptId}`, domainId = 'Measurement'): ResolvedConcept => ({
  conceptId, conceptName, domainId, vocabularyId: 'LOINC', conceptClassId: 'Lab Test', conceptCode: `C${conceptId}`, standardConcept: 'S',
})

const conversion = (conceptId: number, source: number, target: number, factor: number, offset?: number): UnitConversion => ({
  conceptId, conceptName: '', sourceUnitConceptId: source, sourceUnitCode: `u${source}`, sourceUnitName: '',
  conversionFactor: factor, ...(offset === undefined ? {} : { offset }),
  targetUnitConceptId: target, targetUnitCode: `u${target}`, targetUnitName: '',
})

function options(overrides: Partial<OmopSqlOptions>): OmopSqlOptions {
  const cs = v1.conceptSet(155)
  return {
    conceptSet: cs,
    resolved: [measurement(1)],
    unitConversions: [],
    recommendedUnits: [],
    referenceUnitId: null,
    lang: 'en',
    permalink: 'https://example.org/concept-sets/155',
    toolTag: 'tool',
    date: '2026-01-15',
    ...overrides,
  }
}

describe('OMOP SQL: targeted cases', () => {
  it('writes an affine conversion as factor * x + offset, and a pure offset without factor', () => {
    const sql = buildOmopSql(options({
      resolved: [measurement(1)],
      unitConversions: [conversion(1, 100, 200, 0.5555556, -17.7777778), conversion(1, 300, 200, 1, 273.15)],
      referenceUnitId: 200,
    }))
    expect(sql).toContain('WHEN unit_concept_id = 100 THEN value_as_number * 0.5555556 - 17.7777778')
    expect(sql).toContain('WHEN unit_concept_id = 300 THEN value_as_number + 273.15')
    expect(sql).toContain('WHEN unit_concept_id IN (200, 100, 300) THEN 200')
  })

  it('keeps raw values and offers the expected-unit filter when a unit has no conversion', () => {
    const base = options({ resolved: [measurement(1)], unitConversions: [conversion(2, 100, 200, 2)], referenceUnitId: 200 })
    const sql = buildOmopSql(base)
    expect(sql).not.toContain('END AS unit_concept_id')
    expect(sql).toContain('ELSE value_as_number -- unknown unit')
    expect(sql).toContain('-- AND unit_concept_id = 200')
    expect(buildOmopSql({ ...base, dropOtherUnits: true })).toMatch(/\nAND unit_concept_id = 200\n;$/)
  })

  it('ignores conversions into another unit than the reference one', () => {
    const sql = buildOmopSql(options({ unitConversions: [conversion(1, 100, 999, 3)], referenceUnitId: 200 }))
    expect(sql).not.toContain('100')
  })

  it('says so when the set has no standard resolved concept', () => {
    const sql = buildOmopSql(options({ resolved: [{ ...measurement(1), standardConcept: null }] }))
    expect(sql).toContain('-- No standard resolved concepts available.')
    expect(sql).not.toContain('SELECT')
    expect(buildOmopSql(options({ resolved: [] }))).toContain('-- No standard resolved concepts available.')
  })

  it('lists the concepts of a domain with no CDM table, without a query', () => {
    const sql = buildOmopSql(options({ resolved: [measurement(7, 'Serum', 'Specimen')] }))
    expect(sql).toContain('-- No OMOP CDM table mapping for domain "Specimen".')
    expect(sql).toContain('--   7 -- Serum')
    expect(sql).not.toContain('SELECT')
  })

  it('does not take Object.prototype keys for CDM tables', () => {
    expect(domainTable('constructor')).toBeNull()
    expect(domainTable('toString')).toBeNull()
    const sql = buildOmopSql(options({ resolved: [measurement(7, 'x', 'constructor')] }))
    expect(sql).toContain('-- No OMOP CDM table mapping for domain "constructor".')
  })

  it('keeps names, codes and labels inside their comment', () => {
    const evil = 'Glucose\nDROP TABLE person;\r\n-- \u2028SELECT 1'
    const cs: ConceptSet = { ...v1.conceptSet(155), name: evil, version: '1.0\nDROP', metadata: { ...v1.conceptSet(155).metadata, translations: {} } }
    const sql = buildOmopSql(options({
      conceptSet: cs,
      resolved: [measurement(1, evil), measurement(2, evil, `Device\nDROP TABLE x;`)],
      unitConversions: [{ ...conversion(1, 100, 200, 2), sourceUnitCode: 'mg\nDROP TABLE y;' }],
      referenceUnitId: 200,
      unitLabels: { 200: 'mmol\nDROP TABLE z;' },
      permalink: 'https://x/\nDROP TABLE w;',
      toolTag: 'tool\nDROP',
    }))
    for (const line of sql.split('\n')) {
      if (line.includes('DROP')) expect(line).toMatch(/--/)
      if (line.includes('DROP')) expect(line.indexOf('--')).toBeLessThan(line.indexOf('DROP'))
    }
    expect(sqlComment('a\r\nb\u2029c')).toBe('a b c')
  })

  it('never writes a non-integer id into the SQL', () => {
    const bad = { ...measurement(1), conceptId: '1); DROP TABLE person; --' as unknown as number }
    const sql = buildOmopSql(options({ resolved: [bad, measurement(2)], referenceUnitId: '1 OR 1=1' as unknown as number }))
    expect(sql).not.toContain('DROP')
    expect(sql).not.toContain('OR 1=1')
    expect(sql).toContain('-- Note: no reference unit selected')
  })

  it('skips a conversion whose factor is not a finite number', () => {
    const sql = buildOmopSql(options({ unitConversions: [conversion(1, 100, 200, Number.NaN)], referenceUnitId: 200 }))
    expect(sql).not.toContain('NaN')
  })

  it('reads number lexemes kept by the format parser (1.0)', async () => {
    const { parse } = await import('@data-dictionary/format')
    const rows = parse<UnitConversion[]>('[{"conceptId": 1, "sourceUnitConceptId": 100, "conversionFactor": 1.0, "offset": 0.10, "targetUnitConceptId": 200}]')
    const sql = buildOmopSql(options({ unitConversions: rows, referenceUnitId: 200 }))
    expect(sql).toContain('WHEN unit_concept_id = 100 THEN value_as_number + 0.1 --')
  })
})
