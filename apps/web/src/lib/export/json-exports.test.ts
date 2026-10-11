import { describe, expect, it } from 'vitest'
import { parse, serialize, toPlain, type ConceptSet } from '@data-dictionary/format'
import { buildAtlasJson } from './atlas-json'
import { buildIndicateJson, normalizeConceptSetMeta, toolTag } from './indicate-json'
import { buildProjectJson } from './project-json'
import * as v1 from './v1-fixtures'

describe('ATLAS JSON: parity with v1', () => {
  it('covers excluded and descendant items and a custom concept', () => {
    const items = v1.cases.atlas.flatMap((c) => v1.conceptSet(c.conceptSetId).expression.items)
    expect(items.some((i) => i.isExcluded)).toBe(true)
    expect(items.some((i) => i.includeDescendants)).toBe(true)
    expect(items.some((i) => i.concept.conceptId >= 2_000_000_000)).toBe(true)
  })

  it.each(v1.cases.atlas.map((c) => [c.file, c] as const))('%s', (_, c) => {
    expect(buildAtlasJson(v1.conceptSet(c.conceptSetId))).toBe(v1.readGolden(c.file))
  })

  it('fills ATLAS defaults for missing dates and validity', () => {
    const cs = v1.conceptSet(1)
    const item = { ...cs.expression.items[0], concept: { ...cs.expression.items[0].concept, validStartDate: '', validEndDate: null, invalidReason: null, standardConcept: 'C' as const } }
    const out = JSON.parse(buildAtlasJson({ ...cs, expression: { items: [item] } }))
    expect(out.items[0].concept).toMatchObject({
      VALID_START_DATE: '19700101', VALID_END_DATE: '20991231', INVALID_REASON: 'V', STANDARD_CONCEPT: 'C', STANDARD_CONCEPT_CAPTION: 'Classification',
    })
  })

  it('exports an empty expression', () => {
    expect(buildAtlasJson({ ...v1.conceptSet(1), expression: { items: [] } })).toBe('{\n  "items": []\n}')
  })
})

describe('INDICATE JSON: parity with v1', () => {
  it.each(v1.cases.indicate.map((c) => [c.file, c] as const))('%s', (_, c) => {
    const out = buildIndicateJson(v1.conceptSet(c.conceptSetId), {
      toolTag: v1.cases.toolTag,
      date: v1.cases.date,
      modifiedBy: c.modifiedBy,
      repoUrl: v1.cases.repoUrl,
    })
    // v1 wrote JSON.stringify(cs, null, 2); v2 writes the canonical file, with its final newline.
    expect(out).toBe(v1.readGolden(c.file) + '\n')
  })

  it('normalizes a legacy flat organization and places sourceRepo after it', () => {
    const cs = v1.conceptSet(99999)
    const out = normalizeConceptSetMeta(cs, 'https://example.org/repo')
    expect(out.metadata.organization).toEqual({
      created: { name: 'Legacy Org', url: 'https://legacy.example.org' },
      current: { name: 'Legacy Org', url: 'https://legacy.example.org' },
    })
    const keys = Object.keys(out.metadata)
    expect(keys[keys.indexOf('organization') + 1]).toBe('sourceRepo')
    expect(cs.metadata.organization).toEqual({ name: 'Legacy Org', url: 'https://legacy.example.org' })
  })

  it('keeps number lexemes and unknown fields', () => {
    const text = serialize({ ...v1.conceptSet(1), extraField: { kept: true } }, { kind: 'concept-set' })
      .replace('"distributionStats": null', '"distributionStats": {"mean": 1.0}')
    const out = buildIndicateJson(parse<ConceptSet>(text), { toolTag: 't', date: '2026-01-15', repoUrl: 'r' })
    expect(out).toContain('"mean": 1.0')
    expect(out).toContain('"extraField": {\n    "kept": true\n  }')
  })

  it('builds the tool tag', () => {
    expect(toolTag('1.2.6')).toBe(v1.cases.toolTag)
  })
})

describe('project JSON', () => {
  it.each(v1.cases.projectCsv.filter((c) => c.lang === 'en').map((c) => [c.projectId] as const))('project %i is its file', (id) => {
    const p = v1.project(id)
    expect(buildProjectJson(p)).toBe(JSON.stringify(toPlain(p), null, 2) + '\n')
  })
})
