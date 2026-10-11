import { describe, expect, it } from 'vitest'
import { serialize, type Config } from '@data-dictionary/format'
import { applySetupAnswers, setupAnswers, validateSetupAnswers } from './setup-config'

const CONFIG: Config = {
  title: 'Data Dictionary',
  languages: ['en', 'fr'],
  defaultLanguage: 'en',
  repository: { url: 'https://github.com/acme/dd', branch: 'main' },
  branding: { logo: 'logo.png' },
}

describe('setup answers', () => {
  it('unchanged answers leave the config byte-identical', () => {
    expect(serialize(applySetupAnswers(CONFIG, setupAnswers(CONFIG)))).toBe(serialize(CONFIG))
  })

  it('applies organization, name, colors and access, keeping the rest', () => {
    const out = applySetupAnswers(CONFIG, {
      ...setupAnswers(CONFIG),
      organizationName: 'ACME Hospital',
      organizationUrl: 'https://acme.example.org',
      appName: 'ACME Dictionary',
      primary: '#0f766e',
      anonymousRead: false,
    })
    expect(out.organization).toEqual({ name: 'ACME Hospital', url: 'https://acme.example.org' })
    expect(out.branding).toEqual({ logo: 'logo.png', appName: 'ACME Dictionary', colors: { primary: '#0f766e' } })
    expect(out.access).toEqual({ anonymousRead: false })
    expect(out.repository).toEqual(CONFIG.repository)
    expect(out.languages).toEqual(['en', 'fr'])
  })

  it('validates like the Branding settings', () => {
    expect(validateSetupAnswers(CONFIG, setupAnswers(CONFIG))).toBeNull()
    expect(validateSetupAnswers(CONFIG, { ...setupAnswers(CONFIG), primary: 'teal' })).toBe('invalid_primary')
    expect(validateSetupAnswers(CONFIG, { ...setupAnswers(CONFIG), title: '' })).toBe('title_required')
  })
})
