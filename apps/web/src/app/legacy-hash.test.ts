import { describe, expect, it } from 'vitest'
import { translateLegacyHash } from './legacy-hash'

const to = (hash: string) => translateLegacyHash(hash)?.to

describe('translateLegacyHash', () => {
  it('ignores anything that is not a v1 route', () => {
    expect(translateLegacyHash('')).toBeNull()
    expect(translateLegacyHash('#')).toBeNull()
    expect(translateLegacyHash('#access_token=abc&refresh_token=def')).toBeNull()
    expect(translateLegacyHash('#section-heading')).toBeNull()
  })

  it('maps concept set details, with version and tab', () => {
    expect(to('#/concept-sets?id=12&version=1.0.0&tab=review')).toBe('/concept-sets/12?version=1.0.0&tab=reviews')
    expect(to('#/concept-sets?id=12')).toBe('/concept-sets/12')
    expect(to('#/concept-sets?cs=7&tab=comments')).toBe('/concept-sets/7?tab=comments')
    expect(to('#/concept-sets?id=12&tab=bogus&from=project&projectId=3')).toBe('/concept-sets/12')
  })

  it('maps the concept set list and its category filter', () => {
    expect(to('#/concept-sets')).toBe('/concept-sets')
    expect(to('#/concept-sets?category=Conditions%2CVitals')).toBe('/concept-sets?category=Conditions%2CVitals')
    expect(to('#/concept-sets?id=abc')).toBe('/concept-sets')
    expect(to('#/concept-sets?id=0')).toBe('/concept-sets')
  })

  it('maps projects and their tabs', () => {
    expect(to('#/projects')).toBe('/projects')
    expect(to('#/projects?id=1')).toBe('/projects/1')
    expect(to('#/projects?id=1&tab=variables')).toBe('/projects/1?tab=concept-sets')
    expect(to('#/projects?id=1&tab=context')).toBe('/projects/1?tab=description')
  })

  it('maps mapping, and the mapping-recommendations alias', () => {
    expect(to('#/mapping')).toBe('/mapping')
    expect(to('#/mapping?tab=recommendations')).toBe('/mapping?tab=recommendations')
    expect(to('#/mapping-recommendations')).toBe('/mapping?tab=recommendations')
    expect(to('#/mapping?tab=projects&id=abc&detail=concepts')).toBe('/mapping?tab=coverage')
  })

  it('maps settings tabs to settings paths', () => {
    expect(to('#/settings')).toBe('/settings')
    expect(to('#/settings?tab=vocabularies')).toBe('/settings/vocabularies')
    expect(to('#/settings?tab=conversions')).toBe('/settings/units')
    expect(to('#/settings?tab=units')).toBe('/settings/recommended-units')
    expect(to('#/settings?tab=nope')).toBe('/settings')
  })

  it('maps dev tools and documentation sections', () => {
    expect(to('#/dev-tools')).toBe('/dev-tools')
    expect(to('#/dev-tools?tab=erd')).toBe('/dev-tools?section=erd')
    expect(to('#/dev-tools?section=sql')).toBe('/dev-tools')
    expect(to('#/documentation')).toBe('/documentation')
    expect(to('#/documentation?section=json-schema')).toBe('/documentation?section=json-schema')
  })

  it('sends unknown v1 paths to the concept set list, as v1 did', () => {
    expect(to('#/')).toBe('/concept-sets')
    expect(to('#/general-settings')).toBe('/concept-sets')
  })

  it('returns the language of ?lang= and drops it from the path', () => {
    expect(translateLegacyHash('#/projects?id=2&lang=fr')).toEqual({ to: '/projects/2', language: 'fr' })
    expect(translateLegacyHash('#/documentation?lang=en&section=sources')).toEqual({
      to: '/documentation?section=sources',
      language: 'en',
    })
    expect(translateLegacyHash('#/concept-sets?lang=<script>')).toEqual({ to: '/concept-sets' })
  })

  it('skips malformed escapes like v1', () => {
    expect(to('#/concept-sets?id=12&version=%E0%A4%A')).toBe('/concept-sets/12')
  })

  it('encodes values it passes through', () => {
    expect(to('#/concept-sets?id=3&version=1.0.0%26x%3D1')).toBe('/concept-sets/3?version=1.0.0%26x%3D1')
  })
})
