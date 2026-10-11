import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { coverageTargets, sourcesByTarget, statusCounts } from './coverage'
import { expandFiles, guessRoles } from './detect'
import { decode, detectDelimiter, parseDelimited } from './text'
import { MAX_CONCEPT_ID, parseFrequency, parseId, parseTargets } from './values'
import { MappingImportError, type MappingRow } from './types'

describe('delimited text', () => {
  it('detects the delimiter on the first non-blank line, outside quotes', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';')
    expect(detectDelimiter('a\tb,c\tx')).toBe('\t')
    expect(detectDelimiter('"a,b";c;d')).toBe(';')
    expect(detectDelimiter('\t\t\n\na,b')).toBe(',')
    expect(detectDelimiter('single')).toBe(',')
  })

  it('opens quotes only at a field start', () => {
    expect(parseDelimited('a,5" tube,"x,""y"""\n', ',')).toEqual([['a', '5" tube', 'x,"y"']])
    expect(parseDelimited('"multi\nline",b\r\n\r\n,\n', ',')).toEqual([['multi\nline', 'b']])
  })

  it('decodes BOMs, Windows-1252 and UTF-16', () => {
    expect(decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe('a')
    expect(decode(new Uint8Array([0xe9]))).toBe('é')
    expect(decode(new Uint8Array([0x81]))).toBe('\x81')
    expect(decode(new Uint8Array([0xff, 0xfe, 0x61, 0x00]))).toBe('a')
  })
})

describe('values', () => {
  it('reads ids and target cells', () => {
    expect(parseId('3027018.0')).toBe(3027018)
    expect(parseId('1e3')).toBeNull()
    expect(parseId('-5')).toBeNull()
    expect(parseId(String(MAX_CONCEPT_ID + 2))).toBeNull()
    expect(parseTargets('1; 2,2 | 3').ids).toEqual([1, 2, 3])
    expect(parseTargets('0')).toEqual({ ids: [], unmapped: true, invalid: false })
    expect(parseTargets('4, x')).toEqual({ ids: [4], unmapped: false, invalid: true })
    expect(parseFrequency('12.0')).toBe(12)
    expect(parseFrequency('<5')).toBeUndefined()
  })

  it('guesses roles, each header once', () => {
    expect(guessRoles(['concept_id', 'code', 'name'])).toEqual({
      targetConceptId: 'concept_id',
      sourceCode: 'code',
      sourceName: 'name',
    })
  })
})

describe('zip', () => {
  it('drops macOS junk and keeps folders in names', () => {
    const data = zipSync({ 'a/x.csv': strToU8('1'), '__MACOSX/a/._x.csv': strToU8('j'), 'a/.DS_Store': strToU8('j') })
    expect(expandFiles([{ name: 'f.zip', data }]).map((f) => f.name)).toEqual(['a/x.csv'])
  })

  it('rejects a file that is not a zip', () => {
    expect(() => expandFiles([{ name: 'f.zip', data: strToU8('PK nope') }])).toThrow(MappingImportError)
  })
})

describe('coverage helpers', () => {
  const rows: MappingRow[] = [
    { sourceCode: 'A', status: 'approved', targetConceptId: 1 },
    { sourceCode: 'B', status: 'unchecked', targetConceptId: 2 },
    { sourceCode: 'C', targetConceptId: 3 },
    { sourceCode: 'D', status: 'approved', targetConceptId: 0 },
    { sourceCode: 'E', status: 'approved', targetConceptId: 1 },
  ]

  it('filters by status, keeping rows without one', () => {
    expect([...coverageTargets(rows)].sort()).toEqual([1, 2, 3])
    expect([...coverageTargets(rows, ['approved'])].sort()).toEqual([1, 3])
  })

  it('counts statuses and lists the sources of each target', () => {
    expect(statusCounts(rows)).toEqual([
      ['approved', 3],
      ['', 1],
      ['unchecked', 1],
    ])
    expect(sourcesByTarget(rows, ['approved']).get(1)?.map((s) => s.sourceCode)).toEqual(['A', 'E'])
    expect(sourcesByTarget(rows, ['approved']).has(2)).toBe(false)
  })
})
