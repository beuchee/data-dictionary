import { describe, expect, it } from 'vitest'
import { kindForPath } from './kinds.ts'
import { isRawNumber, RawNumber, toNumber, toPlain } from './number.ts'
import { parse } from './parse.ts'
import { serialize } from './serialize.ts'
import { readRepoFile } from './test-helpers.ts'

const roundTrip = (text: string, kind?: Parameters<typeof serialize>[1]) => serialize(parse(text), kind)

describe('serialize', () => {
  it('matches JSON.stringify(v, null, 2) + newline on plain values', () => {
    const v = { a: 1, b: [1, 'x', null, true, { c: [] }, {}], d: { e: 'é – 😀 中文' }, f: -2.5e-7, g: 1e21 }
    expect(serialize(v)).toBe(JSON.stringify(v, null, 2) + '\n')
  })

  it('escapes like JSON.stringify (control chars, quotes, lone surrogates), keeps UTF-8 as is', () => {
    const s = 'a"b\\c\n\r\t\b\f\u0001\u001f\u007f  \ud800 \udc00 😀 é'
    expect(serialize(s, { trailingNewline: false })).toBe(JSON.stringify(s))
    expect(serialize(s)).toContain('\\u0001\\u001f')
    expect(serialize(s)).toContain('\\ud800')
  })

  it('omits undefined members like JSON.stringify and writes null in arrays', () => {
    expect(serialize({ a: undefined, b: 1, c: () => 1 })).toBe('{\n  "b": 1\n}\n')
    expect(serialize({ a: undefined })).toBe('{}\n')
    expect(serialize([undefined])).toBe('[\n  null\n]\n')
  })

  it('refuses non-finite numbers', () => {
    expect(() => serialize({ x: Number.NaN })).toThrow(/non-finite/)
    expect(() => serialize({ x: Infinity })).toThrow(/non-finite/)
  })

  it('applies the per-kind trailing newline (resolved concept sets have none)', () => {
    expect(serialize({}, { kind: 'concept-set' })).toBe('{}\n')
    expect(serialize({}, { kind: 'concept-set-resolved' })).toBe('{}')
    expect(serialize({}, { kind: 'concept-set-resolved', trailingNewline: true })).toBe('{}\n')
  })
})

describe('number lexemes', () => {
  it.each(['1.0', '1000.0', '0.10', '1e-05', '1E+2', '1.5e300', '-0', '-0.0', '12345678901234567890', '0.1000000000000000055511151231257827'])(
    '%s survives a round-trip',
    (lexeme) => {
      const text = `{\n  "x": ${lexeme},\n  "y": [\n    ${lexeme}\n  ]\n}\n`
      expect(roundTrip(text)).toBe(text)
    },
  )

  it('keeps plain numbers plain and wraps only non-reproducible lexemes', () => {
    const v = parse<{ a: unknown; b: unknown; c: unknown }>('{"a": 1.5, "b": 1.0, "c": 3004410}')
    expect(v.a).toBe(1.5)
    expect(v.c).toBe(3004410)
    expect(isRawNumber(v.b)).toBe(true)
    const b = v.b as RawNumber
    expect(b.raw).toBe('1.0')
    expect(toNumber(b)).toBe(1)
    expect(+b * 3).toBe(3)
    expect(toPlain(v)).toEqual({ a: 1.5, b: 1, c: 3004410 })
  })

  it('preserves the 1.0 factors of unit_conversions.json (JSON.stringify would not)', () => {
    const raw = readRepoFile('units/unit_conversions.json')
    expect(raw).toMatch(/"conversionFactor": 1\.0,/)
    expect(JSON.stringify(JSON.parse(raw), null, 2) + '\n').not.toBe(raw)
    expect(roundTrip(raw, { kind: 'unit-conversions' })).toBe(raw)
  })

  it('rejects malformed raw numbers', () => {
    expect(() => new RawNumber('01')).toThrow()
    expect(() => new RawNumber('NaN')).toThrow()
  })
})

describe('parse', () => {
  it('rejects duplicate keys and invalid JSON', () => {
    expect(() => parse('{"a": 1, "a": 2}')).toThrow(/Duplicate key/)
    expect(() => parse('{"a": NaN}')).toThrow()
    expect(() => parse('{"a": 1,}')).toThrow()
  })
})

describe('unknown fields', () => {
  it('survive a read/write cycle at every level, in place', () => {
    const raw = readRepoFile('concept_sets/1.json')
    const cs = parse<Record<string, any>>(raw)
    const extended = {
      ...cs,
      forkField: { nested: [1.0, 'x'] },
      expression: { ...cs.expression, extraExpr: true },
      metadata: { forkMeta: 'kept', ...cs.metadata },
    }
    extended.expression.items[0] = { ...extended.expression.items[0], weight: new RawNumber('2.50') }
    const text = serialize(extended, { kind: 'concept-set' })
    expect(serialize(parse(text), { kind: 'concept-set' })).toBe(text)
    expect(text).toContain('"weight": 2.50')
    expect(text).toContain('"forkMeta": "kept"')
    expect(text.indexOf('"forkMeta"')).toBeLessThan(text.indexOf('"uniqueId"'))
    expect(text.trimEnd().endsWith('"forkField": {\n    "nested": [\n      1,\n      "x"\n    ]\n  }\n}')).toBe(true)
  })
})

describe('kindForPath', () => {
  it('maps repo paths to kinds', () => {
    expect(kindForPath('concept_sets/12.json')).toBe('concept-set')
    expect(kindForPath('concept_sets_resolved/12.json')).toBe('concept-set-resolved')
    expect(kindForPath('projects\\3.json')).toBe('project')
    expect(kindForPath('./config.json')).toBe('config')
    expect(kindForPath('units/unit_conversions.json')).toBe('unit-conversions')
    expect(kindForPath('concept_set.example.json')).toBeNull()
    expect(kindForPath('concept_sets/abc.json')).toBeNull()
  })
})
