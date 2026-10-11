import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import type { ExpressionItem, ResolvedConcept } from '@data-dictionary/format'
import { resolveItems, sqlLookup, stampVersion, versionFromRows, type ResolutionLookup } from './resolver'
import { descendantIds, QueryError } from './sql'

// The tiny ATHENA export and what resolve.py makes of each expression
// (apps/api/tests/fixtures/vocab/, see make_fixture.py and make_expected.py).
const FIXTURE = path.resolve(__dirname, '../../../../api/tests/fixtures/vocab')
const cases = JSON.parse(readFileSync(path.join(FIXTURE, 'resolve-cases.json'), 'utf-8')) as {
  name: string
  items: ExpressionItem[]
  vocabularyVersion: Record<string, string | null>
  resolvedConcepts: ResolvedConcept[]
}[]

function table(name: string): Record<string, string | null>[] {
  const [header, ...lines] = readFileSync(path.join(FIXTURE, 'athena', `${name}.csv`), 'utf-8').trimEnd().split('\n')
  const cols = header.split('\t')
  return lines.map((line) => {
    const values = line.split('\t')
    return Object.fromEntries(cols.map((c, i) => [c, values[i] === '' ? null : values[i]]))
  })
}

const concepts = new Map(table('CONCEPT').map((r) => [Number(r.concept_id), r]))
const ancestors = table('CONCEPT_ANCESTOR').map((r) => ({
  ancestor: Number(r.ancestor_concept_id),
  descendant: Number(r.descendant_concept_id),
  level: Number(r.min_levels_of_separation),
}))
const relationships = table('CONCEPT_RELATIONSHIP')

/** The vocabulary in memory, `closure` reading the whole ancestor table as the
 *  server does, `edges` walking its direct rows as the browser does. */
function memoryLookup(mode: 'closure' | 'edges'): ResolutionLookup {
  const children = (id: number) => ancestors.filter((a) => a.level === 1 && a.ancestor === id).map((a) => a.descendant)
  return {
    descendants: async (ids) => {
      if (mode === 'closure') {
        return ancestors.filter((a) => ids.includes(a.ancestor) && a.descendant !== a.ancestor).map((a) => a.descendant)
      }
      const seen = new Set<number>()
      const queue = ids.flatMap(children)
      while (queue.length) {
        const id = queue.shift()!
        if (seen.has(id)) continue
        seen.add(id)
        queue.push(...children(id))
      }
      return [...seen]
    },
    mapped: async (ids) =>
      relationships
        .filter((r) => ids.includes(Number(r.concept_id_1)) && ['Maps to', 'Mapped from'].includes(r.relationship_id!))
        .map((r) => Number(r.concept_id_2)),
    details: async (ids) =>
      ids
        .filter((id) => concepts.has(id))
        .map((id) => {
          const r = concepts.get(id)!
          return {
            conceptId: id,
            conceptName: r.concept_name!,
            vocabularyId: r.vocabulary_id!,
            domainId: r.domain_id!,
            conceptClassId: r.concept_class_id!,
            conceptCode: r.concept_code!,
            standardConcept: (r.standard_concept ?? null) as ResolvedConcept['standardConcept'],
          }
        }),
  }
}

const version = versionFromRows(
  table('VOCABULARY').map((r) => ({ vocabulary_id: r.vocabulary_id, vocabulary_version: r.vocabulary_version })),
)

describe('resolveItems', () => {
  it.each(cases.map((c) => [c.name, c] as const))('matches resolve.py: %s', async (_, c) => {
    for (const mode of ['closure', 'edges'] as const) {
      const resolved = await resolveItems(c.items, memoryLookup(mode))
      expect(resolved).toEqual(c.resolvedConcepts)
      expect(stampVersion(version, resolved)).toEqual(c.vocabularyVersion)
    }
  })

  it('refuses a concept id that is not an integer', async () => {
    const items = [{ concept: { conceptId: '1) OR (1=1' }, includeDescendants: true }] as unknown as ExpressionItem[]
    await expect(resolveItems(items, memoryLookup('closure'))).rejects.toThrow(QueryError)
  })

  it('reads nothing for an empty or all-excluded expression', async () => {
    const lookup: ResolutionLookup = {
      descendants: () => Promise.reject(new Error('unexpected')),
      mapped: () => Promise.reject(new Error('unexpected')),
      details: () => Promise.reject(new Error('unexpected')),
    }
    await expect(resolveItems(null, lookup)).resolves.toEqual([])
    const excluded = [{ concept: { conceptId: 1 }, isExcluded: true, includeDescendants: true }] as ExpressionItem[]
    await expect(resolveItems(excluded, lookup)).resolves.toEqual([])
  })
})

describe('sqlLookup', () => {
  it('runs the shared builders and reads bigint ids', async () => {
    const seen: string[] = []
    const lookup = sqlLookup(async (q) => {
      seen.push(q.sql)
      return [{ concept_id: 5n }, { concept_id: 7n }]
    }, 'edges')
    expect(await lookup.descendants([3, 1])).toEqual([5, 7])
    expect(seen[0]).toBe(descendantIds([1, 3], 'edges').sql)
  })
})

describe('versionFromRows', () => {
  it('keeps the release under its own key', () => {
    expect(version?.release).toBe('v5.0 01-SEP-26')
    expect(version?.LOINC).toBe('LOINC 2.81')
    expect(versionFromRows([])).toBeNull()
    expect(stampVersion(null, [])).toBeNull()
  })
})
