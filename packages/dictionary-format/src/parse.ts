/**
 * Lossless JSON parsing: same values as `JSON.parse`, except that a number whose
 * lexeme JavaScript would not print back identically comes out as a `RawNumber`
 * (see number.ts). Duplicate keys are an error (JSON.parse would silently keep
 * the last one).
 */
import { parse as losslessParse } from 'lossless-json'
import { parseNumberLexeme } from './number.ts'

export function parse<T = unknown>(text: string): T {
  return losslessParse(text, null, { parseNumber: parseNumberLexeme }) as T
}
