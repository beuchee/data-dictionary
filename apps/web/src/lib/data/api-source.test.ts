import { describe, expect, it } from 'vitest'
import { resolvedQueryString } from './api-source'

describe('resolvedQueryString', () => {
  it('is empty without parameters', () => {
    expect(resolvedQueryString()).toBe('')
    expect(resolvedQueryString({ search: '  ', offset: 0 })).toBe('')
  })

  it('encodes every parameter given', () => {
    expect(resolvedQueryString({ version: '1.0.0', search: ' a&b ', offset: 20, limit: 10 })).toBe(
      '?version=1.0.0&search=a%26b&offset=20&limit=10',
    )
  })
})
