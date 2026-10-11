import { describe, expect, it } from 'vitest'
import { DOC_GROUPS, flattenSections, localized, neighbours, resolveSection, sectionFromHref, type DocSection } from './doc-index'

const SECTIONS: DocSection[] = [
  { id: 'introduction', icon: 'BookOpen', title: { en: 'Introduction', fr: 'Introduction' } },
  { id: 'browsing', icon: 'Search', title: { en: 'Browsing', fr: 'Parcourir' } },
  { id: 'concept-set-details', icon: 'FileText', title: { en: 'Details' } },
]

describe('resolveSection', () => {
  it('selects the section named by ?section=', () => {
    expect(resolveSection('browsing', SECTIONS)).toEqual({ id: 'browsing', known: true })
    expect(resolveSection('concept-set-details', SECTIONS)).toEqual({ id: 'concept-set-details', known: true })
  })

  it('opens the first section when the parameter is missing or blank', () => {
    expect(resolveSection(null, SECTIONS)).toEqual({ id: 'introduction', known: true })
    expect(resolveSection(undefined, SECTIONS)).toEqual({ id: 'introduction', known: true })
    expect(resolveSection('   ', SECTIONS)).toEqual({ id: 'introduction', known: true })
  })

  it('falls back to the first section, flagged, for an unknown id', () => {
    expect(resolveSection('nope', SECTIONS)).toEqual({ id: 'introduction', known: false })
    expect(resolveSection('Browsing', SECTIONS)).toEqual({ id: 'introduction', known: false })
    expect(resolveSection('../en/browsing', SECTIONS)).toEqual({ id: 'introduction', known: false })
  })

  it('trims surrounding spaces', () => {
    expect(resolveSection(' browsing ', SECTIONS)).toEqual({ id: 'browsing', known: true })
  })

  it('returns an empty id when there is no section at all', () => {
    expect(resolveSection('browsing', [])).toEqual({ id: '', known: false })
  })

  it('resolves every v1 section id (old #/documentation?section=… links)', () => {
    const v1 = [
      'introduction', 'getting-started', 'what-are-concept-sets', 'browsing', 'concept-set-details',
      'editing-concept-sets', 'reviewing', 'exporting', 'json-schema', 'sources', 'projects',
      'mapping-projects', 'mapping-recommendations', 'dictionary-settings', 'dev-tools', 'local-data',
      'forking', 'sharing-concept-sets',
    ]
    const sections = flattenSections()
    for (const id of v1) expect(resolveSection(id, sections)).toEqual({ id, known: true })
    expect(sections.map((s) => s.id)).toEqual(v1)
  })
})

describe('sectionFromHref', () => {
  it('reads in-app documentation links', () => {
    expect(sectionFromHref('?section=browsing')).toBe('browsing')
    expect(sectionFromHref('/documentation?section=json-schema')).toBe('json-schema')
    expect(sectionFromHref('#/documentation?section=reviewing')).toBe('reviewing')
    expect(sectionFromHref('?foo=1&section=projects#groups')).toBe('projects')
  })

  it('ignores every other link', () => {
    expect(sectionFromHref(undefined)).toBeNull()
    expect(sectionFromHref('')).toBeNull()
    expect(sectionFromHref('https://example.org/?section=browsing')).toBeNull()
    expect(sectionFromHref('#heading')).toBeNull()
    expect(sectionFromHref('/concept-sets?section=browsing')).toBeNull()
    expect(sectionFromHref('?section=')).toBeNull()
  })
})

describe('neighbours', () => {
  it('gives the previous and next sections in reading order', () => {
    expect(neighbours('browsing', SECTIONS)).toEqual({ prev: SECTIONS[0], next: SECTIONS[2] })
    expect(neighbours('introduction', SECTIONS)).toEqual({ prev: null, next: SECTIONS[1] })
    expect(neighbours('concept-set-details', SECTIONS)).toEqual({ prev: SECTIONS[1], next: null })
    expect(neighbours('nope', SECTIONS)).toEqual({ prev: null, next: null })
  })

  it('crosses group boundaries', () => {
    const sections = flattenSections(DOC_GROUPS)
    const lastOfFirstGroup = DOC_GROUPS[0].sections.at(-1)!
    expect(neighbours(lastOfFirstGroup.id, sections).next).toEqual(DOC_GROUPS[1].sections[0])
  })
})

describe('localized', () => {
  it('never falls back to another language', () => {
    expect(localized({ en: 'Details' }, 'en')).toBe('Details')
    expect(localized({ en: 'Details' }, 'fr')).toBeNull()
    expect(localized({ en: 'Details', fr: '  ' }, 'fr')).toBeNull()
  })
})
