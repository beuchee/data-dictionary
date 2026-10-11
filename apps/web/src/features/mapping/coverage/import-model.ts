// The import dialog's pure part: what to show and parse for the current choices.
import {
  detectFormat,
  expandFiles,
  guessRoles,
  MappingImportError,
  parseMapping,
  readCells,
  tableFromCells,
  type Detection,
  type InputFile,
  type MappingFormat,
  type ParseOptions,
  type ParseResult,
} from '@/lib/mapping-import'
import { extensionOf, isTabular } from '@/lib/mapping-import/table'
import { parseId } from '@/lib/mapping-import/values'

/** Formats read from one table, whose rows the preview shows as such. */
export const TABLE_FORMATS: readonly MappingFormat[] = ['generic', 'concept_ids', 'stcm', 'usagi']

export interface PreviewTable {
  headers: string[]
  rows: string[][]
  /** Data rows in the whole table. */
  total: number
  sheetNames: string[] | null
}

export interface ImportModel {
  files: InputFile[]
  error: MappingImportError | null
  detection: Detection | null
  preview: PreviewTable | null
  result: ParseResult | null
  /** XLSX sheets / delimited text, for the option controls. */
  isXlsx: boolean
  isText: boolean
}

function asImportError(error: unknown): MappingImportError {
  if (error instanceof MappingImportError) return error
  console.error('Mapping import failed:', error)
  return new MappingImportError('unsupported_file', error instanceof Error ? error.message : String(error))
}

/** Expand and detect once per set of files. */
export function inspectFiles(files: InputFile[]): { expanded: InputFile[]; detection: Detection | null; error: MappingImportError | null } {
  try {
    const expanded = expandFiles(files)
    return { expanded, detection: detectFormat(expanded), error: null }
  } catch (error) {
    return { expanded: [], detection: null, error: asImportError(error) }
  }
}

/** The first table as the options read it (10 rows), for a table format. */
export function previewTable(expanded: InputFile[], options: ParseOptions): PreviewTable | null {
  if (!TABLE_FORMATS.includes(options.format)) return null
  const file = expanded.find(isTabular)
  if (!file) return null
  const { cells, sheetNames } = readCells(file, options)
  let hasHeader = options.hasHeader
  if (options.format === 'concept_ids' && hasHeader === undefined) {
    // The parser's rule: a header when the first cell is not an id.
    hasHeader = parseId(cells[Math.max(0, options.skipRows ?? 0)]?.[0]) === null
  }
  const table = tableFromCells(cells, { ...options, hasHeader })
  return { headers: table.headers, rows: table.rows.slice(0, 10), total: table.rows.length, sheetNames }
}

export function buildModel(files: InputFile[], expanded: InputFile[], detection: Detection | null, options: ParseOptions): ImportModel {
  const first = expanded.find(isTabular)
  const base: ImportModel = {
    files,
    error: null,
    detection,
    preview: null,
    result: null,
    isXlsx: !!first && extensionOf(first.name) === '.xlsx',
    isText: !!first && extensionOf(first.name) !== '.xlsx',
  }
  try {
    base.preview = previewTable(expanded, options)
  } catch (error) {
    return { ...base, error: asImportError(error) }
  }
  try {
    base.result = parseMapping(files, options)
  } catch (error) {
    base.error = asImportError(error)
  }
  return base
}

/** The options to start from for a format: the detection's, plus guessed roles for a generic table. */
export function optionsFor(format: MappingFormat, detection: Detection | null, expanded: InputFile[], current: ParseOptions): ParseOptions {
  const base: ParseOptions = {
    format,
    delimiter: current.delimiter,
    encoding: current.encoding,
    sheet: current.sheet,
  }
  if (detection?.format === format) return { ...base, ...detection.options, format }
  if (format === 'generic') {
    try {
      const file = expanded.find(isTabular)
      if (file) {
        const { cells } = readCells(file, base)
        return { ...base, columns: guessRoles(tableFromCells(cells, { hasHeader: true }).headers) }
      }
    } catch {
      // an unreadable file shows its error once parsed
    }
  }
  return base
}
