import { describe, expect, it } from 'vitest'
import { isUsernameErrorFromApi, isValidUsername } from './username-rule'

describe('isValidUsername', () => {
  it.each(['abc', 'jane.doe', 'j_doe-2', 'A'.repeat(64)])('accepts %s', (name) => {
    expect(isValidUsername(name)).toBe(true)
  })

  it.each(['ad', 'jane doe', 'tab\there', 'nul\u0000x', 'émile', 'a'.repeat(65), 'x/y', '', ' abc'])(
    'refuses %j',
    (name) => {
      expect(isValidUsername(name)).toBe(false)
    },
  )
})

describe('isUsernameErrorFromApi', () => {
  it('reads the code from a body, its text or an error', () => {
    const body = { detail: { code: 'username_invalid', message: '…' } }
    expect(isUsernameErrorFromApi(body)).toBe(true)
    expect(isUsernameErrorFromApi(JSON.stringify(body))).toBe(true)
    expect(isUsernameErrorFromApi(new Error(JSON.stringify(body)))).toBe(true)
  })

  it('is false for anything else', () => {
    expect(isUsernameErrorFromApi({ detail: { code: 'password_common' } })).toBe(false)
    expect(isUsernameErrorFromApi('not json')).toBe(false)
    expect(isUsernameErrorFromApi(null)).toBe(false)
  })
})
