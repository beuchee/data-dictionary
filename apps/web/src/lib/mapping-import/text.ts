import type { Delimiter, Encoding } from './types'

// Whitespace trimmed from cells, the same set in the Python twin (JS `trim` and
// Python `strip` disagree on a few code points).
const WS = ' \t\r\n\f\v ﻿'
const TRIM_RE = new RegExp(`^[${WS}]+|[${WS}]+$`, 'g')

export function clean(value: string): string {
  return value.replace(TRIM_RE, '')
}

/** Header key for name matching: lower case, no spaces, `_` or `-`. */
export function headerKey(header: string): string {
  return clean(header).toLowerCase().replace(/[ \t_-]/g, '')
}

function isUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

/**
 * Bytes → text. 'auto': UTF-16 when a BOM says so, UTF-8 when valid, else
 * Windows-1252 (an Excel "CSV" on Windows). A leading BOM is dropped.
 */
export function decode(bytes: Uint8Array, encoding: Encoding = 'auto'): string {
  let label: string = encoding
  if (encoding === 'auto') {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) label = 'utf-16le'
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) label = 'utf-16be'
    else label = isUtf8(bytes) ? 'utf-8' : 'windows-1252'
  }
  const text = new TextDecoder(label).decode(bytes)
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

const CANDIDATES = [',', '\t', ';', '|'] as const

/** The candidate seen most often outside quotes on the first non-blank line (ties: `,` tab `;` `|`). */
export function detectDelimiter(text: string): Exclude<Delimiter, 'auto'> {
  let counts = new Map<string, number>(CANDIDATES.map((c) => [c, 0]))
  let inQuotes = false
  let content = false
  for (const c of text) {
    if (c === '"') {
      inQuotes = !inQuotes
      content = true
    } else if (inQuotes) continue
    else if (c === '\n' || c === '\r') {
      if (content) break
      counts = new Map(CANDIDATES.map((d) => [d, 0]))
    } else {
      if (counts.has(c)) counts.set(c, counts.get(c)! + 1)
      if (!WS.includes(c) && !counts.has(c)) content = true
    }
  }
  let best: Exclude<Delimiter, 'auto'> = ','
  for (const c of CANDIDATES) if (counts.get(c)! > counts.get(best)!) best = c
  return best
}

/**
 * RFC 4180-ish: `"` opens quoting only at the start of a field (`""` inside is a
 * quote; elsewhere it is a plain character), CRLF / LF / CR end a row, rows
 * whose cells are all blank are dropped. Cells are returned untrimmed.
 */
export function parseDelimited(text: string, delimiter: Exclude<Delimiter, 'auto'>): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let fieldStart = true
  const endRow = () => {
    row.push(field)
    if (row.some((v) => clean(v) !== '')) rows.push(row)
    row = []
    field = ''
    fieldStart = true
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += c
      continue
    }
    if (c === '"' && fieldStart) {
      inQuotes = true
      fieldStart = false
    } else if (c === delimiter) {
      row.push(field)
      field = ''
      fieldStart = true
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      endRow()
    } else {
      field += c
      fieldStart = false
    }
  }
  if (field !== '' || row.length > 0) endRow()
  return rows
}
