import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  conceptSetSummary,
  filterResolved,
  normalizeOrganization,
  pageResolved,
  versionHistory,
} from './catalog'
import type { ConceptSet, ResolvedConcept } from './types'

// Written by the API's content_store (see apps/api/tests/test_content_store.py), so
// the static source is checked against what the server returns.
const golden = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../../api/tests/fixtures/catalog-golden.json'), 'utf-8'),
) as {
  cases: {
    conceptSet: ConceptSet
    resolvedCount: number | null
    versionsIndex: Record<string, string>
    summary: unknown
    history: unknown
  }[]
}

const concepts: ResolvedConcept[] = Array.from({ length: 6 }, (_, i) => ({
  conceptId: 1000 + i,
  conceptName: `Concept ${i} ${i % 2 ? 'glucose' : 'sodium'}`,
  vocabularyId: 'LOINC',
  domainId: 'Measurement',
  conceptClassId: 'Lab Test',
  conceptCode: `${i}-0`,
  standardConcept: 'S',
}))

describe('parity with the API', () => {
  it.each(golden.cases.map((c) => [c.conceptSet.id, c] as const))('summarizes concept set %i like the API', (_, c) => {
    expect(conceptSetSummary(c.conceptSet, c.resolvedCount)).toEqual(c.summary)
  })

  it.each(golden.cases.map((c) => [c.conceptSet.id, c] as const))('lists the versions of %i like the API', (_, c) => {
    expect(versionHistory(c.conceptSet, c.versionsIndex)).toEqual(c.history)
  })
})

describe('normalizeOrganization', () => {
  it('reads the legacy flat shape as both created and current', () => {
    const flat = { name: 'A', url: null }
    expect(normalizeOrganization(flat)).toEqual({ created: flat, current: flat })
  })

  it('defaults current to created', () => {
    const created = { name: 'A' }
    expect(normalizeOrganization({ created })).toEqual({ created, current: created })
  })

  it('is null for anything else', () => {
    expect(normalizeOrganization(null)).toBeNull()
    expect(normalizeOrganization('x')).toBeNull()
    expect(normalizeOrganization([])).toBeNull()
  })
})

describe('filterResolved / pageResolved', () => {
  it('matches id, name, code and vocabulary, case-insensitively', () => {
    expect(filterResolved(concepts, undefined)).toHaveLength(6)
    expect(filterResolved(concepts, '  ')).toHaveLength(6)
    expect(filterResolved(concepts, 'GLUCOSE').map((c) => c.conceptId)).toEqual([1001, 1003, 1005])
    expect(filterResolved(concepts, '1004').map((c) => c.conceptId)).toEqual([1004])
    expect(filterResolved(concepts, '2-0').map((c) => c.conceptId)).toEqual([1002])
    expect(filterResolved(concepts, 'loinc')).toHaveLength(6)
    expect(filterResolved(concepts, 'nothing')).toEqual([])
  })

  it('counts the filtered list, then pages it', () => {
    const page = pageResolved({ resolvedConcepts: concepts, vocabularyVersion: null }, 7, '1.0.0', {
      search: 'glucose',
      offset: 1,
      limit: 1,
    })
    expect(page).toEqual({
      conceptSetId: 7,
      version: '1.0.0',
      vocabularyVersion: null,
      total: 3,
      offset: 1,
      limit: 1,
      resolvedConcepts: [concepts[3]],
    })
  })

  it('returns everything after the offset without a limit, and nothing past the end', () => {
    const resolved = { resolvedConcepts: concepts, vocabularyVersion: { release: 'x' } }
    expect(pageResolved(resolved, 1, null, { offset: 4 }).resolvedConcepts).toHaveLength(2)
    expect(pageResolved(resolved, 1, null, { offset: 40, limit: 5 }).resolvedConcepts).toEqual([])
    expect(pageResolved(resolved, 1, null).limit).toBeNull()
  })
})

describe('compareVersions', () => {
  it('compares numerically, a pre-release before its release', () => {
    const sorted = ['1.2.0', '1.10.0', '1.9.9', '2.0.0-rc.1', '2.0.0', '1.0'].sort(compareVersions)
    expect(sorted).toEqual(['1.0', '1.2.0', '1.9.9', '1.10.0', '2.0.0-rc.1', '2.0.0'])
  })
})
