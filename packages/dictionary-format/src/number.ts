/**
 * A JSON number whose lexeme JavaScript cannot reproduce: `1.0` (would print as
 * `1`), `0.10`, `1e-05`, `-0`, integers beyond 2^53… `parse` returns one of these
 * instead of a plain number so `serialize` can write the original bytes back.
 * Every other number stays a plain `number`.
 *
 * It behaves as a number in arithmetic (`valueOf`), but not for `typeof` or
 * `===`: read it through `toNumber`.
 */
export class RawNumber {
  readonly raw: string

  constructor(raw: string) {
    if (!JSON_NUMBER.test(raw)) throw new SyntaxError(`Not a JSON number: ${JSON.stringify(raw)}`)
    this.raw = raw
  }

  valueOf(): number {
    return Number(this.raw)
  }

  toString(): string {
    return this.raw
  }

  toJSON(): number {
    return Number(this.raw)
  }
}

const JSON_NUMBER = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/

/** A parsed JSON number: plain when JavaScript prints it back identically. */
export type JsonNumber = number | RawNumber

export function isRawNumber(value: unknown): value is RawNumber {
  return value instanceof RawNumber
}

/** The numeric value of a parsed number, raw or plain. */
export function toNumber(value: JsonNumber): number {
  return typeof value === 'number' ? value : Number(value.raw)
}

/** The parser's number hook: plain number when lossless, RawNumber otherwise. */
export function parseNumberLexeme(raw: string): JsonNumber {
  const n = Number(raw)
  return String(n) === raw ? n : new RawNumber(raw)
}

/** Deep copy with every RawNumber replaced by its plain number (what JSON.parse gives). */
export function toPlain<T = unknown>(value: unknown): T {
  if (value instanceof RawNumber) return Number(value.raw) as T
  if (Array.isArray(value)) return value.map((v) => toPlain(v)) as T
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = toPlain(v)
    return out as T
  }
  return value as T
}
