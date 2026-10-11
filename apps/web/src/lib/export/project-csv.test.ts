import { describe, expect, it } from 'vitest'
import { buildProjectCsv, csvField, groupName, pinnedConceptSets, projectCsvFilename, projectGroups } from './project-csv'
import * as v1 from './v1-fixtures'
import type { ConceptSet, Project } from '@data-dictionary/format'

describe('project CSV: parity with v1', () => {
  it('covers every project, past versions included', () => {
    expect(new Set(v1.cases.projectCsv.map((c) => c.projectId)).size).toBeGreaterThanOrEqual(6)
    expect(v1.cases.pinned.length).toBeGreaterThan(0)
  })

  it.each(v1.cases.projectCsv.map((c) => [c.file, c] as const))('%s', (_, c) => {
    const p = v1.project(c.projectId)
    expect(buildProjectCsv(p, v1.pinnedLookup, c.lang)).toBe(v1.readGolden(c.file))
    expect(projectCsvFilename(p, c.lang)).toBe(c.filename)
  })
})

const cs = (id: number, name: string): ConceptSet => {
  const base = v1.conceptSet(1)
  return { ...base, id, name, metadata: { ...base.metadata, translations: { en: { name } } } }
}

describe('project CSV: targeted cases', () => {
  it('neutralizes spreadsheet formulas but keeps numbers', () => {
    expect(csvField('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"')
    expect(csvField('+1+1')).toBe('"\'+1+1"')
    expect(csvField('@SUM(A1)')).toBe('"\'@SUM(A1)"')
    expect(csvField('-12.5')).toBe('"-12.5"')
    expect(csvField('-')).toBe('"\'-"')
    expect(csvField(null)).toBe('""')
    expect(csvField('a\nb')).toBe('"a\nb"')
  })

  it('reads a legacy flat project as one default group at the current versions', () => {
    const legacy = { id: 9, translations: { en: { name: 'Old' } }, conceptSetIds: [1] } as Project
    expect(projectGroups(legacy)).toHaveLength(1)
    expect(groupName(projectGroups(legacy)[0], 'fr')).toBe('Par défaut')
    const seen: (string | undefined)[] = []
    const csv = buildProjectCsv(legacy, (id, version) => { seen.push(version); return cs(id, 'Set') }, 'en')
    expect(seen).toEqual([undefined])
    expect(csv.split('\n')).toHaveLength(1 + v1.conceptSet(1).expression.items.length)
    expect(pinnedConceptSets(legacy)).toEqual([{ id: 1, version: '' }])
  })

  it('skips a concept set the lookup does not know', () => {
    const p = { id: 9, translations: {}, groups: [{ id: 'g', rule: 'optional', conceptSets: [{ id: 404, version: '1.0.0' }] }] } as Project
    expect(buildProjectCsv(p, () => null, 'en')).toBe('﻿' + 'group_name,group_rule,concept_set_id,concept_set_name,concept_set_category,concept_set_subcategory,concept_id,concept_name,domain_id,vocabulary_id,concept_class_id,concept_code,standard_concept,invalid_reason,valid_start_date,valid_end_date,is_excluded,include_descendants,include_mapped')
  })

  it('makes a safe file name', () => {
    expect(projectCsvFilename({ id: 1, translations: { en: { name: 'Sepsis / ICU (v2)' } } }, 'en')).toBe('Sepsis___ICU__v2__concepts.csv')
    expect(projectCsvFilename({ id: 1, translations: {} }, 'en')).toBe('project_concepts.csv')
  })
})
