import { describe, expect, it } from 'vitest'
import { customConcepts } from './catalog'
import type { ConceptSet } from './types'

const cs = (id: number, ...ids: unknown[]) =>
  ({ id, expression: { items: ids.map((i) => ({ concept: { conceptId: i, conceptName: `n${String(i)}` } })) } }) as unknown as ConceptSet

describe('customConcepts (twin of the API route)', () => {
  it('lists each custom id once, first definition by set id, with its sets', () => {
    const out = customConcepts([cs(3, 2_100_000_002, 5), cs(1, 2_100_000_002, 2_100_000_007, '2100000009'), { id: 2, expression: null } as unknown as ConceptSet])
    expect(out.map((c) => [c.conceptId, c.conceptName, c.conceptSetIds])).toEqual([
      [2_100_000_002, 'n2100000002', [1, 3]],
      [2_100_000_007, 'n2100000007', [1]],
    ])
  })
})
