import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import * as sql from './sql'

// Produced by apps/api/tests/fixtures/vocab/make_expected.py from the Python builders.
const golden = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../../api/tests/fixtures/vocab/sql-golden.json'), 'utf-8'),
) as {
  cases: { builder: string; input: Record<string, unknown>; output: unknown }[]
  rejects: { builder: string; input: Record<string, unknown> }[]
}

type Input = Record<string, unknown>

/** The golden file's builder names and inputs → the TS builders (same camelCase keys). */
const BUILDERS: Record<string, (a: Input) => unknown> = {
  conceptSearch: (a) => sql.conceptSearch(a as sql.ConceptSearchInput),
  conceptById: (a) => sql.conceptById(a.conceptId),
  relatedConcepts: (a) => sql.relatedConcepts(a.conceptId),
  synonyms: (a) => sql.synonyms(a.conceptId),
  hierarchyNodes: (a) => sql.hierarchyNodes(a.conceptId, a.mode as sql.HierarchyMode, a.maxDepth ?? 5, a.limit ?? 150),
  hierarchyEdges: (a) => sql.hierarchyEdges(a.ids as unknown[]),
  descendantIds: (a) => sql.descendantIds(a.ids as unknown[], a.mode as sql.HierarchyMode),
  mappedIds: (a) => sql.mappedIds(a.ids as unknown[]),
  resolvedDetails: (a) => sql.resolvedDetails(a.ids as unknown[]),
  vocabularyVersions: () => sql.vocabularyVersions(),
  filterOptions: (a) => sql.filterOptions(a.column),
}

describe('SQL builders', () => {
  it('cover every builder of the golden file', () => {
    expect(new Set(golden.cases.map((c) => c.builder))).toEqual(new Set(Object.keys(BUILDERS)))
  })

  it.each(golden.cases.map((c) => [`${c.builder} ${JSON.stringify(c.input)}`, c] as const))(
    'produce the same SQL as the API: %s',
    (_, c) => {
      expect(BUILDERS[c.builder](c.input)).toEqual(c.output)
    },
  )

  it.each(golden.rejects.map((c) => [`${c.builder} ${JSON.stringify(c.input)}`, c] as const))(
    'refuse unsafe input like the API: %s',
    (_, c) => {
      expect(() => BUILDERS[c.builder](c.input)).toThrow(sql.QueryError)
    },
  )

  it('keep user text out of the SQL', () => {
    const evil = "x'); DROP TABLE concept; --"
    const { page, count } = sql.conceptSearch({ term: evil, domainIds: [evil], vocabularyIds: [evil] })
    for (const q of [page, count]) {
      expect(q.sql).not.toContain('DROP')
      expect(q.params).toContain(evil)
    }
  })

  it('reject ids that are not safe integers', () => {
    for (const bad of [-1, 1.5, Number.NaN, Infinity, 2 ** 53, '7', 7n, null, undefined, {}]) {
      expect(() => sql.conceptById(bad)).toThrow(sql.QueryError)
      expect(() => sql.mappedIds([1, bad])).toThrow(sql.QueryError)
    }
    expect(sql.conceptById(Number.MAX_SAFE_INTEGER).sql).toContain(String(Number.MAX_SAFE_INTEGER))
  })

  it('clamp limits and depths', () => {
    expect(sql.conceptSearch({ limit: 0, offset: -5 }).page.sql).toMatch(/LIMIT 1 OFFSET 0$/)
    expect(sql.hierarchyNodes(1, 'edges', 0, 99_999).sql).toMatch(/depth < 1\).*LIMIT 2001$/)
    expect(() => sql.hierarchyNodes(1, 'edges', '3')).toThrow(sql.QueryError)
  })

  it('treat only plain digits as an id search', () => {
    expect(sql.conceptSearch({ term: '103' }).page.sql).toContain('c.concept_id = 103')
    for (const term of ['1e3', '0x10', '10 OR 1=1', '-3', '٣']) {
      expect(sql.conceptSearch({ term }).page.sql).not.toContain('c.concept_id =')
    }
  })
})
