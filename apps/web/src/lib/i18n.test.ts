import { describe, expect, it } from 'vitest'
import { resolveLanguage } from './i18n'

describe('resolveLanguage', () => {
  it('keeps a stored language the instance offers', () => {
    expect(resolveLanguage('fr', ['en', 'fr'], 'en')).toBe('fr')
  })

  it('falls back to the instance default for an unknown or missing choice', () => {
    expect(resolveLanguage('de', ['en', 'fr'], 'fr')).toBe('fr')
    expect(resolveLanguage(null, ['en', 'fr'], 'fr')).toBe('fr')
  })

  it('falls back to the first language when the default is not offered', () => {
    expect(resolveLanguage(undefined, ['fr', 'en'], 'de')).toBe('fr')
  })
})
