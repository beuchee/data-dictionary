import { describe, expect, it } from 'vitest'
import { oauthProviders, oauthStartUrl, parseOAuthFragment } from './oauth'

describe('OAuth', () => {
  it('offers the enabled providers it knows, in a fixed order', () => {
    expect(oauthProviders(['local', 'orcid', 'github', 'saml'])).toEqual(['github', 'orcid'])
    expect(oauthProviders(['local'])).toEqual([])
    expect(oauthProviders(undefined)).toEqual([])
  })

  it('starts at the API, which redirects', () => {
    expect(oauthStartUrl('', 'gitlab')).toBe('/api/v1/auth/oauth/gitlab/start?redirect=true')
    expect(oauthStartUrl('https://dd.example.org/', 'github')).toBe('https://dd.example.org/api/v1/auth/oauth/github/start?redirect=true')
  })

  it('reads the tokens of a sign-in or a link', () => {
    expect(parseOAuthFragment('#access_token=a.b.c&refresh_token=r%2Bs&provider=github')).toEqual({
      ok: true,
      accessToken: 'a.b.c',
      refreshToken: 'r+s',
      provider: 'github',
      linked: false,
    })
    expect(parseOAuthFragment('access_token=a&refresh_token=r&provider=orcid&linked=1')).toMatchObject({ linked: true, provider: 'orcid' })
  })

  it('reads an error, sanitised', () => {
    expect(parseOAuthFragment('#error=identity_in_use')).toEqual({ ok: false, error: 'identity_in_use' })
    expect(parseOAuthFragment('#error=%3Cscript%3E')).toEqual({ ok: false, error: 'unknown' })
  })

  it('ignores an empty or partial fragment', () => {
    expect(parseOAuthFragment('')).toBeNull()
    expect(parseOAuthFragment('#access_token=a')).toBeNull()
    expect(parseOAuthFragment('#provider=github')).toBeNull()
  })
})
