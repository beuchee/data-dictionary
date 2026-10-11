import { describe, expect, it } from 'vitest'
import { createMappingsStore } from '@/stores/mappings-store'
import { eligibilityRows, evaluate, matchedTargets, pinnedEntries } from './eligibility'
import type { ConceptSetSummary, DictionarySource, Project } from '@/lib/data'
import type { MappingSource } from '@/lib/mappings'

const project = {
  id: 1,
  groups: [
    { id: 'g1', rule: 'all_required', translations: { en: { name: 'Vitals' } }, conceptSets: [{ id: 10, version: '1.0.0' }, { id: 11, version: '2.0.0' }] },
    { id: 'g2', rule: 'at_least_one', conceptSets: [{ id: 12, version: '1.0.0' }] },
  ],
} as unknown as Project
const legacy = { id: 2, conceptSetIds: [10] } as unknown as Project
const current = (id: number) => (id === 10 ? '1.1.0' : null)

describe('eligibility', () => {
  it('lists every pinned version once, legacy ids at the current one', () => {
    expect(pinnedEntries([project, legacy, project], current)).toEqual([
      { id: 10, version: '1.0.0' },
      { id: 11, version: '2.0.0' },
      { id: 12, version: '1.0.0' },
      { id: 10, version: '1.1.0' },
    ])
  })

  it('scores against the pinned lists and flattens to rows', () => {
    const resolved = { '10@1.0.0': [1, 2], '11@2.0.0': [3], '12@1.0.0': null }
    const coverage = evaluate(project, new Set([2, 99]), resolved, current)
    expect(coverage.score).toBe(25)
    expect(coverage.eligible).toBe(false)
    const summaries = new Map([[10, { id: 10, translations: { en: { name: 'Heart rate' } } } as unknown as ConceptSetSummary]])
    const rows = eligibilityRows(project, coverage, summaries, 'en', current)
    expect(rows.map((r) => [r.groupName, r.rule, r.conceptSetId, r.name, r.covered, r.available, r.resolved])).toEqual([
      ['Vitals', 'all_required', 10, 'Heart rate', true, true, 2],
      ['Vitals', 'all_required', 11, null, false, true, 1],
      [null, 'at_least_one', 12, null, false, false, 0],
    ])
    expect(matchedTargets(new Set([2, 3, 99]), resolved)).toBe(2)
  })
})

describe('mappings store', () => {
  it('loads each pinned resolved list once, ids only, null when missing', async () => {
    const calls: string[] = []
    const dictionary = {
      getResolved: async (id: number, query: { version?: string }) => {
        calls.push(`${id}@${query.version ?? ''}`)
        if (id === 12) return null
        if (id === 13) throw new Error('offline')
        return { resolvedConcepts: [{ conceptId: id * 10 }, { conceptId: id * 10 + 1 }] }
      },
    } as unknown as DictionarySource
    const store = createMappingsStore(() => ({}) as MappingSource, () => dictionary)
    const entries = [
      { id: 10, version: '1.0.0' },
      { id: 12, version: '1.0.0' },
      { id: 13, version: '' },
      { id: 10, version: '1.0.0' },
    ]
    await store.getState().loadResolvedIds(entries)
    await store.getState().loadResolvedIds(entries)
    expect(calls).toEqual(['10@1.0.0', '12@1.0.0', '13@'])
    const r = store.getState().resolvedIds
    expect(r['10@1.0.0'].data).toEqual([100, 101])
    expect(r['12@1.0.0']).toEqual({ data: null, status: 'ready', error: null })
    expect(r['13@'].status).toBe('error')
  })
})
