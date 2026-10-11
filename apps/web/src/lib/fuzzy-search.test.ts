// Adapted from linkr@1310cf4a4 apps/web/src/lib/fuzzy-search.test.ts
import { describe, expect, it } from 'vitest'
import { fuzzyFilter, fuzzyRank, fuzzyTextMatch } from './fuzzy-search'

describe('fuzzyTextMatch', () => {
  it('matches exactly', () => {
    expect(fuzzyTextMatch('plaquettes', 'plaquettes')).toBe(true)
  })

  it('is accent- and case-insensitive', () => {
    expect(fuzzyTextMatch('Fréquence Cardiaque', 'frequence cardiaque')).toBe(true)
  })

  it('matches on prefix', () => {
    expect(fuzzyTextMatch('plaquettes', 'plaq')).toBe(true)
  })

  it('matches when every query word appears as a substring', () => {
    expect(fuzzyTextMatch('hémoglobine glyquée', 'glyquee hemoglobine')).toBe(true)
  })

  it('tolerates a typo via Jaro-Winkler', () => {
    expect(fuzzyTextMatch('plaquettes', 'plquettes')).toBe(true)
  })

  it('rejects an unrelated term', () => {
    expect(fuzzyTextMatch('plaquettes', 'créatinine')).toBe(false)
  })

  it('an empty query matches everything', () => {
    expect(fuzzyTextMatch('anything', '   ')).toBe(true)
  })

  it('null/undefined value never matches a non-empty query', () => {
    expect(fuzzyTextMatch(null, 'x')).toBe(false)
    expect(fuzzyTextMatch(undefined, 'x')).toBe(false)
  })
})

describe('fuzzyRank', () => {
  it('orders exact < prefix < substring < fuzzy', () => {
    const exact = fuzzyRank('Heart rate', 'heart rate')!
    const prefix = fuzzyRank('Heart rate', 'heart')!
    const substring = fuzzyRank('Mean heart rate', 'heart')!
    const fuzzy = fuzzyRank('Heart rate', 'haert rate')!
    expect(exact).toBeLessThan(prefix)
    expect(prefix).toBeLessThan(substring)
    expect(substring).toBeLessThan(fuzzy)
  })

  it('treats regex metacharacters literally', () => {
    expect(fuzzyRank('pH (arterial)', '(arterial)')).toBe(2)
    expect(fuzzyRank('pH arterial', '.*')).toBeNull()
  })
})

describe('fuzzyFilter', () => {
  const items = [
    { id: 1, name: 'Mean arterial pressure' },
    { id: 2, name: 'Heart rate' },
    { id: 3, name: 'Creatinine' },
    { id: 4, name: 'Heart rate variability' },
  ]
  const names = (i: { name: string }) => [i.name]

  it('returns the items unchanged for an empty query', () => {
    expect(fuzzyFilter(items, '  ', names)).toBe(items)
  })

  it('keeps matches only, best first, stable within a rank', () => {
    expect(fuzzyFilter(items, 'heart rate', names).map((i) => i.id)).toEqual([2, 4])
    expect(fuzzyFilter(items, 'pressure', names).map((i) => i.id)).toEqual([1])
  })

  it('takes the best rank across the texts of an item', () => {
    const rows = [
      { id: 1, texts: ['zzz', 'Creatinine'] },
      { id: 2, texts: ['Creatinine clearance'] },
    ]
    expect(fuzzyFilter(rows, 'creatinine', (r) => r.texts).map((r) => r.id)).toEqual([1, 2])
  })

  it('ignores missing texts', () => {
    expect(fuzzyFilter([{ t: null }, { t: 'abc' }], 'abc', (r) => [r.t])).toEqual([{ t: 'abc' }])
  })
})
