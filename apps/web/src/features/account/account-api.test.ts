import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api-client'
import { apiErrorCode, fullName } from '@/features/users/users-api'
import { isLastSignInMethod, linkableProviders, tokenState } from './account-api'

describe('tokenState', () => {
  const now = new Date('2026-10-11T12:00:00Z')
  it('revoked wins, then expiry', () => {
    expect(tokenState({ revokedAt: '2026-10-01T00:00:00Z', expiresAt: null }, now)).toBe('revoked')
    expect(tokenState({ revokedAt: null, expiresAt: '2026-10-11T11:59:59Z' }, now)).toBe('expired')
    expect(tokenState({ revokedAt: null, expiresAt: '2026-10-12T00:00:00Z' }, now)).toBe('active')
    expect(tokenState({ revokedAt: null, expiresAt: null }, now)).toBe('active')
  })
})

describe('linked accounts', () => {
  it('offers the enabled providers not linked yet, never local', () => {
    expect(linkableProviders(['local', 'github', 'orcid'], [{ provider: 'github' }])).toEqual(['orcid'])
    expect(linkableProviders(['local'], [])).toEqual([])
  })

  it('knows the last sign-in method', () => {
    const identity = { id: 1, provider: 'github', username: null, email: null, createdAt: null }
    expect(isLastSignInMethod({ hasPassword: false, identities: [identity] })).toBe(true)
    expect(isLastSignInMethod({ hasPassword: true, identities: [identity] })).toBe(false)
    expect(isLastSignInMethod({ hasPassword: false, identities: [identity, { ...identity, id: 2 }] })).toBe(false)
  })
})

describe('users api helpers', () => {
  it('reads the error code of a refusal', () => {
    expect(apiErrorCode(new ApiError(409, '{"detail":{"code":"last_admin","message":"x"}}'))).toBe('last_admin')
    expect(apiErrorCode(new ApiError(403, '{"detail":"Insufficient permissions"}'))).toBeNull()
    expect(apiErrorCode(new ApiError(500, 'oops'))).toBeNull()
    expect(apiErrorCode(new Error('x'))).toBeNull()
  })

  it('full name', () => {
    expect(fullName({ firstName: ' Ada ', lastName: 'Lovelace' })).toBe('Ada Lovelace')
    expect(fullName({ firstName: null, lastName: ' ' })).toBeNull()
  })
})
