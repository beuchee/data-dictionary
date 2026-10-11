import { describe, expect, it } from 'vitest'
import { displayName, initials, userHasPermission, type AuthUser } from './auth-store'

const user = (overrides: Partial<AuthUser> = {}): AuthUser => ({
  id: 1,
  username: 'jdoe',
  email: null,
  role: 'viewer',
  is_active: true,
  ...overrides,
})

describe('userHasPermission', () => {
  it('allows everything in static mode', () => {
    expect(userHasPermission(null, 'users:manage', false)).toBe(true)
  })

  it('follows the permission list in server mode', () => {
    expect(userHasPermission(user({ permissions: ['concept-sets:read'] }), 'concept-sets:read', true)).toBe(true)
    expect(userHasPermission(user({ permissions: ['concept-sets:read'] }), 'concept-sets:commit', true)).toBe(false)
  })

  it('treats a missing list or user as no permission, and admin as every permission', () => {
    expect(userHasPermission(user(), 'concept-sets:read', true)).toBe(false)
    expect(userHasPermission(null, 'concept-sets:read', true)).toBe(false)
    expect(userHasPermission(user({ role: 'admin' }), 'users:manage', true)).toBe(true)
  })
})

describe('displayName / initials', () => {
  it('prefers the full name', () => {
    const u = user({ first_name: 'Jane', last_name: ' Doe ' })
    expect(displayName(u)).toBe('Jane Doe')
    expect(initials(u)).toBe('JD')
  })

  it('falls back to the username', () => {
    expect(displayName(user({ first_name: '  ', last_name: null }))).toBe('jdoe')
    expect(initials(user())).toBe('JD')
    expect(initials(user({ last_name: 'Martin' }))).toBe('M')
  })
})
