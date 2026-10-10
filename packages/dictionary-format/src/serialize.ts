/**
 * The canonical on-disk bytes of a content file.
 *
 * Format: 2-space indent, one item per line, `": "` after keys, empty containers
 * as `[]` / `{}`, non-ASCII written as is (UTF-8), keys in insertion order, and a
 * final newline except for resolved concept sets (see TRAILING_NEWLINE). That is
 * exactly `JSON.stringify(v, null, 2)` and Python's
 * `json.dumps(v, indent=2, ensure_ascii=False)`, with one addition: a `RawNumber`
 * is written with its original lexeme, so `serialize(parse(text))` gives back
 * `text` byte for byte. Twin: python/src/dictionary_format/serialize.py.
 */
import { TRAILING_NEWLINE, type FileKind } from './kinds.ts'
import { RawNumber } from './number.ts'

export interface SerializeOptions {
  /** The file kind; decides the trailing newline. */
  kind?: FileKind
  /** Override the kind's default (true when no kind is given). */
  trailingNewline?: boolean
}

export function serialize(value: unknown, options: SerializeOptions = {}): string {
  const newline = options.trailingNewline ?? (options.kind ? TRAILING_NEWLINE[options.kind] : true)
  const out: string[] = []
  if (!write(value, '', out)) throw new TypeError('Cannot serialize a top-level undefined value')
  if (newline) out.push('\n')
  return out.join('')
}

/** Appends `value`; returns false (and appends nothing) for a value JSON omits. */
function write(value: unknown, indent: string, out: string[]): boolean {
  if (value instanceof RawNumber) {
    out.push(value.raw)
    return true
  }
  if (value !== null && typeof value === 'object' && typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    value = (value as { toJSON: () => unknown }).toJSON()
  }
  switch (typeof value) {
    case 'string':
      out.push(JSON.stringify(value))
      return true
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`Cannot serialize non-finite number ${value}`)
      out.push(JSON.stringify(value))
      return true
    case 'bigint':
      out.push(value.toString())
      return true
    case 'boolean':
      out.push(value ? 'true' : 'false')
      return true
    case 'undefined':
    case 'function':
    case 'symbol':
      return false
  }
  if (value === null) {
    out.push('null')
    return true
  }
  const inner = indent + '  '
  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.push('[]')
      return true
    }
    out.push('[')
    value.forEach((item, i) => {
      out.push(i === 0 ? '\n' : ',\n', inner)
      if (!write(item, inner, out)) out.push('null')
    })
    out.push('\n', indent, ']')
    return true
  }
  let first = true
  out.push('{')
  for (const key of Object.keys(value as object)) {
    const mark = out.length
    out.push(first ? '\n' : ',\n', inner, JSON.stringify(key), ': ')
    if (write((value as Record<string, unknown>)[key], inner, out)) first = false
    else out.length = mark
  }
  if (first) {
    out[out.length - 1] = '{}'
    return true
  }
  out.push('\n', indent, '}')
  return true
}
