import * as XLSX from 'xlsx'
import { clean, decode, detectDelimiter, parseDelimited } from './text'
import { MappingImportError, type Delimiter, type InputFile, type TableOptions } from './types'

export interface Table {
  headers: string[]
  /** Data rows, header excluded; a short row reads as blank cells. */
  rows: string[][]
  /** XLSX only: every sheet, in workbook order. */
  sheetNames: string[] | null
  /** Delimited text only: the delimiter used. */
  delimiter: Exclude<Delimiter, 'auto'> | null
}

const TEXT_EXTENSIONS = ['.csv', '.tsv', '.txt', '.tab']

export function extensionOf(name: string): string {
  const base = name.split('/').pop() ?? name
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot).toLowerCase() : ''
}

export function isXlsx(file: InputFile): boolean {
  return extensionOf(file.name) === '.xlsx'
}

export function isTabular(file: InputFile): boolean {
  const ext = extensionOf(file.name)
  return ext === '.xlsx' || ext === '' || TEXT_EXTENSIONS.includes(ext)
}

function cellText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value instanceof Date) {
    const iso = value.toISOString()
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 19)
  }
  return String(value)
}

/** The cells of an XLSX sheet as text; numbers as JS prints them (`3027018`, `1.5`). */
export function readXlsx(data: Uint8Array, sheet?: string): { cells: string[][]; sheetNames: string[] } {
  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(data, { type: 'array', cellDates: true, UTC: true })
  } catch {
    throw new MappingImportError('unsupported_file', 'unreadable workbook')
  }
  const sheetNames = wb.SheetNames
  const name = sheet ?? sheetNames[0]
  if (!name || !sheetNames.includes(name)) throw new MappingImportError('unknown_sheet', sheet ?? null)
  const raw = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false })
  const cells = raw.map((r) => r.map(cellText)).filter((r) => r.some((v) => clean(v) !== ''))
  return { cells, sheetNames }
}

/** The physical rows of a tabular file (no header handling). */
export function readCells(
  file: InputFile,
  options: TableOptions = {},
): { cells: string[][]; sheetNames: string[] | null; delimiter: Exclude<Delimiter, 'auto'> | null } {
  if (!isTabular(file)) throw new MappingImportError('unsupported_file', file.name)
  if (isXlsx(file)) return { ...readXlsx(file.data, options.sheet), delimiter: null }
  const text = decode(file.data, options.encoding)
  const delimiter = !options.delimiter || options.delimiter === 'auto' ? detectDelimiter(text) : options.delimiter
  return { cells: parseDelimited(text, delimiter), sheetNames: null, delimiter }
}

/** Headers are trimmed; an empty or repeated one is renamed `column_<n>` (n = its 1-based position). */
export function tableFromCells(cells: string[][], options: TableOptions = {}): Omit<Table, 'sheetNames' | 'delimiter'> {
  const rows = cells.slice(Math.max(0, options.skipRows ?? 0))
  if (rows.length === 0) throw new MappingImportError('empty_file')
  let width = 0
  for (const r of rows) width = Math.max(width, r.length)
  const hasHeader = options.hasHeader ?? true
  const seen = new Set<string>()
  const headers = Array.from({ length: width }, (_, i) => {
    let h = hasHeader ? clean(rows[0][i] ?? '') : ''
    if (!h || seen.has(h)) h = `column_${i + 1}`
    seen.add(h)
    return h
  })
  return { headers, rows: hasHeader ? rows.slice(1) : rows }
}

export function readTable(file: InputFile, options: TableOptions = {}): Table {
  const { cells, sheetNames, delimiter } = readCells(file, options)
  return { ...tableFromCells(cells, options), sheetNames, delimiter }
}
