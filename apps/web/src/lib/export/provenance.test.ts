import { describe, expect, it } from 'vitest'
import { RawNumber, serialize, type ConceptSet } from '@data-dictionary/format'
import { cloneContent, stampConceptSetEdit, withSourceRepo } from './provenance'
import * as v1 from './v1-fixtures'

const stamp = {
  date: '2026-10-11',
  modifiedBy: 'Ada Lovelace',
  repoUrl: 'https://gitlab.com/team/dd',
  organization: { name: 'My Org', url: 'https://my.org' },
}

describe('stampConceptSetEdit', () => {
  it('makes this repo and organization the current maintainers, never touching created or origin', () => {
    const cs = v1.conceptSet(155)
    const before = cloneContent(cs)
    const out = stampConceptSetEdit(cs, stamp)
    expect(out.metadata.sourceRepo).toBe(stamp.repoUrl)
    const org = out.metadata.organization as { created: unknown; current: unknown }
    expect(org.current).toEqual(stamp.organization)
    expect(org.created).toEqual((before.metadata.organization as { created: unknown }).created)
    expect(out.metadata.origin).toEqual(before.metadata.origin)
    expect(out.modifiedDate).toBe('2026-10-11')
    expect(out.modifiedBy).toBe('Ada Lovelace')
    expect(cs).toEqual(before)
  })

  it('keeps the canonical key order (sourceRepo right after organization)', () => {
    const out = stampConceptSetEdit(v1.conceptSet(155), stamp)
    const keys = Object.keys(out.metadata)
    expect(keys[keys.indexOf('organization') + 1]).toBe('sourceRepo')
    expect(Object.keys(out)).toEqual(Object.keys(v1.conceptSet(155)))
  })

  it('normalizes a legacy flat organization before setting current', () => {
    const out = stampConceptSetEdit(v1.conceptSet(99999), stamp)
    expect(out.metadata.organization).toEqual({
      created: { name: 'Legacy Org', url: 'https://legacy.example.org' },
      current: stamp.organization,
    })
  })

  it('mirrors the root name and description from English', () => {
    const cs = cloneContent(v1.conceptSet(1))
    cs.metadata.translations.en.name = 'Renamed'
    cs.metadata.translations.en.shortDescription = null
    const out = stampConceptSetEdit(cs, stamp)
    expect(out.name).toBe('Renamed')
    expect(out.description).toBeNull()
  })

  it('leaves the root alone without an English translation, and modifiedBy without a name', () => {
    const cs: ConceptSet = { ...v1.conceptSet(1), metadata: { ...v1.conceptSet(1).metadata, translations: { fr: { name: 'Seul' } } } }
    const out = stampConceptSetEdit(cs, { ...stamp, modifiedBy: '  ', organization: null })
    expect(out.name).toBe(cs.name)
    expect(out.modifiedBy).toBe(cs.modifiedBy)
    expect(out.metadata.organization).toEqual(cs.metadata.organization)
  })

  it('keeps number lexemes', () => {
    const cs = v1.conceptSet(1)
    const withStats = { ...cs, metadata: { ...cs.metadata, distributionStats: { mean: new RawNumber('1.0') } } }
    expect(serialize(stampConceptSetEdit(withStats, stamp))).toContain('"mean": 1.0')
  })
})

describe('withSourceRepo', () => {
  it('appends when there is no organization, and moves an existing key', () => {
    expect(Object.keys(withSourceRepo({ a: 1, b: 2 }, 'u'))).toEqual(['a', 'b', 'sourceRepo'])
    expect(Object.keys(withSourceRepo({ sourceRepo: 'x', organization: {}, z: 1 }, 'u'))).toEqual(['organization', 'sourceRepo', 'z'])
  })
})
