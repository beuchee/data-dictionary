// Twin of apps/api/app/services/mapping_import/ (same rules, same fixtures:
// apps/api/tests/fixtures/mappings/cases.json, checked by both suites).

export const MAPPING_FORMATS = ['generic', 'stcm', 'ccr', 'sssom', 'usagi', 'linkr', 'concept_ids'] as const
export type MappingFormat = (typeof MAPPING_FORMATS)[number]

/** One normalized mapping line. Absent fields are left out, never null. */
export interface MappingRow {
  sourceVocabularyId?: string
  sourceCode?: string
  sourceName?: string
  /** A 2-billion id for a local concept. */
  sourceConceptId?: number
  /** 0 = the source code is known but unmapped. */
  targetConceptId: number
  /** A CURIE (`skos:exactMatch`…) when the format carries one. */
  equivalence?: string
  /** Lower-cased: `approved`, `unchecked`, `flagged`… */
  status?: string
  frequency?: number
}

export const COLUMN_ROLES = [
  'sourceVocabularyId',
  'sourceCode',
  'sourceName',
  'sourceConceptId',
  'targetConceptId',
  'equivalence',
  'status',
  'frequency',
] as const
export type ColumnRole = (typeof COLUMN_ROLES)[number]
/** Role → header name (as read, after trimming). */
export type ColumnRoles = Partial<Record<ColumnRole, string>>

export const DELIMITERS = ['auto', ',', ';', '\t', '|'] as const
export type Delimiter = (typeof DELIMITERS)[number]
export const ENCODINGS = ['auto', 'utf-8', 'windows-1252'] as const
export type Encoding = (typeof ENCODINGS)[number]

export interface TableOptions {
  /** Default 'auto': the most frequent of `,` tab `;` `|` on the first line. */
  delimiter?: Delimiter
  /** Default 'auto': UTF-16 by BOM, else UTF-8, else Windows-1252. */
  encoding?: Encoding
  /** XLSX: the sheet; default the first. */
  sheet?: string
  /** Default true. Without, columns are named `column_1`, `column_2`… */
  hasHeader?: boolean
  /** Lines dropped before the header. */
  skipRows?: number
}

export interface ParseOptions extends TableOptions {
  format: MappingFormat
  /** `generic` (required: `targetConceptId`) and `concept_ids` (optional: the id column). */
  columns?: ColumnRoles
}

export interface InputFile {
  name: string
  data: Uint8Array
}

export interface ParseStats {
  /** Records read (data lines, JSON entries, relationship rows…). */
  totalRows: number
  /** Output rows with a target. */
  mappedRows: number
  /** Output rows with target 0. */
  unmappedRows: number
  /** Records dropped (see warnings). */
  skippedRows: number
  uniqueTargets: number
}

export const WARNING_CODES = [
  'invalid_target',
  'invalid_mapping',
  'invalid_concept',
  'negated',
  'non_omop_object',
  'blank_row',
] as const
export type WarningCode = (typeof WARNING_CODES)[number]

export interface ParseWarning {
  code: WarningCode
  count: number
  /** First record numbers (1-based, header excluded), at most 5. */
  rows: number[]
}

export interface ParseResult {
  format: MappingFormat
  rows: MappingRow[]
  stats: ParseStats
  warnings: ParseWarning[]
  /** Statuses counted by default (lower-case); null = every row. */
  defaultStatuses: string[] | null
  /** A name found in the file (Linkr project, SSSOM title), to prefill the import name. */
  suggestedName: string | null
}

export const ERROR_CODES = [
  'no_file',
  'unsupported_file',
  'empty_file',
  'bad_zip',
  'invalid_json',
  'unknown_sheet',
  'missing_columns',
  'missing_file',
] as const
export type MappingImportErrorCode = (typeof ERROR_CODES)[number]

export class MappingImportError extends Error {
  readonly code: MappingImportErrorCode
  readonly detail: string | null
  constructor(code: MappingImportErrorCode, detail: string | null = null) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'MappingImportError'
    this.code = code
    this.detail = detail
  }
}
