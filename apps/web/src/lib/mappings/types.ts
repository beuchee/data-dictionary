import type {
  InputFile,
  MappingFormat,
  MappingRow,
  ParseOptions,
  ParseResult,
  ParseStats,
  ParseWarning,
} from '@/lib/mapping-import/types'

/** An imported mapping, without its rows (`GET /mappings`). */
export interface MappingImportSummary {
  id: string
  name: string
  description: string | null
  format: MappingFormat
  /** The uploaded file names, comma-separated. */
  sourceFileName: string
  options: ParseOptions
  stats: ParseStats
  warnings: ParseWarning[]
  /** Statuses counted by default; null = every row. */
  defaultStatuses: string[] | null
  createdBy: string | null
  /** ISO 8601. */
  createdAt: string
}

export interface MappingImportDetail extends MappingImportSummary {
  rows: MappingRow[]
}

export interface NewMappingImport {
  name: string
  description: string
  files: InputFile[]
  options: ParseOptions
  /** The browser's parse of `files`; the static store keeps it, the server parses again. */
  parsed: ParseResult
}

/**
 * Where imports live: the API (server mode, shared by the instance) or
 * IndexedDB (static mode, this browser only). Get it with `getMappingSource()`.
 */
export interface MappingSource {
  readonly kind: 'api' | 'local'
  list(): Promise<MappingImportSummary[]>
  /** null when unknown. */
  get(id: string): Promise<MappingImportDetail | null>
  create(input: NewMappingImport): Promise<MappingImportSummary>
  remove(id: string): Promise<void>
}
