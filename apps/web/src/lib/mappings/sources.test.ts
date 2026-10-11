import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api-client'
import { MappingImportError, type ParseResult } from '@/lib/mapping-import/types'
import { importErrorFrom } from './api-source'
import { summaryOf } from './local-source'

describe('importErrorFrom', () => {
  it("turns the server's 422 into the parser's error", () => {
    const e = importErrorFrom(new ApiError(422, JSON.stringify({ detail: { code: 'missing_columns', detail: 'x' } })))
    expect(e).toBeInstanceOf(MappingImportError)
    expect((e as MappingImportError).code).toBe('missing_columns')
    expect((e as MappingImportError).detail).toBe('x')
  })

  it('leaves anything else alone', () => {
    const validation = new ApiError(422, JSON.stringify({ detail: [{ loc: ['body'] }] }))
    expect(importErrorFrom(validation)).toBe(validation)
    const unknown = new ApiError(422, JSON.stringify({ detail: { code: 'nope' } }))
    expect(importErrorFrom(unknown)).toBe(unknown)
    const other = new ApiError(500, 'boom')
    expect(importErrorFrom(other)).toBe(other)
  })
})

describe('summaryOf', () => {
  const parsed: ParseResult = {
    format: 'linkr',
    rows: [],
    stats: { totalRows: 0, mappedRows: 0, unmappedRows: 0, skippedRows: 0, uniqueTargets: 0 },
    warnings: [],
    defaultStatuses: ['approved'],
    suggestedName: 'Adult ICU',
  }
  const files = [{ name: 'a.zip', data: new Uint8Array() }, { name: 'b.json', data: new Uint8Array() }]

  it('names the import after the file when the user did not', () => {
    const s = summaryOf({ name: ' ', description: '', files, options: { format: 'linkr' }, parsed }, 'id', '2026-01-01')
    expect(s.name).toBe('Adult ICU')
    expect(s.description).toBeNull()
    expect(s.sourceFileName).toBe('a.zip, b.json')
    expect(s.defaultStatuses).toEqual(['approved'])
  })

  it('keeps the format the parser used', () => {
    const s = summaryOf({ name: 'X', description: 'd', files, options: { format: 'generic' }, parsed }, 'id', '2026-01-01')
    expect(s.options.format).toBe('linkr')
    expect(s.name).toBe('X')
  })
})
