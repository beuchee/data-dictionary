import { clean } from './text'
import type { MappingFormat, MappingRow, ParseResult, ParseWarning, WarningCode } from './types'

/** Same bound as the vocabulary routes: ids beyond it lose precision in JS. */
export const MAX_CONCEPT_ID = Number.MAX_SAFE_INTEGER

// Plain digits, with a `.0` tail tolerated (pandas writes an integer column
// holding blanks as floats). Not Number(): it would read `1e3` or `0x10`.
const ID_RE = /^(\d+)(?:\.0+)?$/

/** A non-negative concept id, or null when the text is not one. */
export function parseId(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 && value <= MAX_CONCEPT_ID ? value : null
  if (typeof value !== 'string') return null
  const digits = ID_RE.exec(clean(value))?.[1]
  if (digits === undefined) return null
  const n = Number(digits)
  return n <= MAX_CONCEPT_ID ? n : null
}

export interface Targets {
  ids: number[]
  /** No id, but a blank or a `0`: the source is unmapped. */
  unmapped: boolean
  /** A token that is not an id. */
  invalid: boolean
}

/** The target ids of a cell: one or several, separated by `;`, `,`, `|` or spaces (deduplicated, in order). */
export function parseTargets(value: unknown): Targets {
  if (value == null) return { ids: [], unmapped: true, invalid: false }
  if (typeof value === 'number') {
    const id = parseId(value)
    if (id === null) return { ids: [], unmapped: false, invalid: true }
    return id === 0 ? { ids: [], unmapped: true, invalid: false } : { ids: [id], unmapped: false, invalid: false }
  }
  if (typeof value !== 'string') return { ids: [], unmapped: false, invalid: true }
  const ids: number[] = []
  let invalid = false
  for (const token of clean(value).split(/[;,| \t\r\n]+/)) {
    if (!token) continue
    const id = parseId(token)
    if (id === null) invalid = true
    else if (id !== 0 && !ids.includes(id)) ids.push(id)
  }
  return { ids, unmapped: ids.length === 0 && !invalid, invalid }
}

/** A count: a non-negative number, or undefined. */
export function parseFrequency(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : undefined
  if (typeof value !== 'string') return undefined
  const text = clean(value)
  if (!/^\d+(?:\.\d+)?$/.test(text)) return undefined
  const n = Number(text)
  return Number.isFinite(n) ? n : undefined
}

/** A cleaned, non-empty string, or undefined. */
export function text(value: unknown): string | undefined {
  if (value == null) return undefined
  const s = clean(typeof value === 'string' ? value : String(value))
  return s === '' ? undefined : s
}

export function status(value: unknown): string | undefined {
  return text(value)?.toLowerCase()
}

const LEGACY_EQUIVALENCE: Record<string, string> = {
  equal: 'skos:exactMatch',
  equivalent: 'skos:closeMatch',
  wider: 'skos:broadMatch',
  narrower: 'skos:narrowMatch',
  inexact: 'skos:relatedMatch',
}

/** Usagi's enum and Linkr's legacy values → SKOS; a CURIE passes through; UNMATCHED / UNREVIEWED → undefined. */
export function equivalence(value: unknown): string | undefined {
  const s = text(value)
  if (!s) return undefined
  if (s.includes(':')) return s
  return LEGACY_EQUIVALENCE[s.toLowerCase()]
}

/** Collects output rows, skipped records and warnings while a parser runs. */
export class RowSink {
  readonly rows: MappingRow[] = []
  totalRows = 0
  skippedRows = 0
  private readonly warnings = new Map<WarningCode, ParseWarning>()

  /** A record read. */
  read(): void {
    this.totalRows++
  }

  warn(code: WarningCode, row: number): void {
    const w = this.warnings.get(code) ?? { code, count: 0, rows: [] }
    w.count++
    if (w.rows.length < 5) w.rows.push(row)
    this.warnings.set(code, w)
  }

  skip(code: WarningCode, row: number): void {
    this.skippedRows++
    this.warn(code, row)
  }

  /** One output row per target, or one unmapped row; undefined fields dropped. */
  add(source: Omit<MappingRow, 'targetConceptId'>, targets: number[]): void {
    const base: Omit<MappingRow, 'targetConceptId'> = {}
    for (const [k, v] of Object.entries(source) as [keyof typeof source, unknown][]) {
      if (v !== undefined && v !== null) (base as Record<string, unknown>)[k] = v
    }
    if (targets.length === 0) this.rows.push({ ...base, targetConceptId: 0 })
    for (const t of targets) this.rows.push({ ...base, targetConceptId: t })
  }

  /** `add` from a target cell; returns false when the record was skipped. */
  addCell(source: Omit<MappingRow, 'targetConceptId'>, cell: unknown, row: number): boolean {
    const t = parseTargets(cell)
    if (t.ids.length > 0) {
      if (t.invalid) this.warn('invalid_target', row)
      this.add(source, t.ids)
      return true
    }
    if (t.invalid) {
      this.skip('invalid_target', row)
      return false
    }
    this.add(source, [])
    return true
  }

  result(
    format: MappingFormat,
    defaultStatuses: string[] | null = null,
    suggestedName: string | null = null,
  ): ParseResult {
    const targets = new Set<number>()
    let mapped = 0
    for (const r of this.rows) {
      if (r.targetConceptId !== 0) {
        mapped++
        targets.add(r.targetConceptId)
      }
    }
    return {
      format,
      rows: this.rows,
      stats: {
        totalRows: this.totalRows,
        mappedRows: mapped,
        unmappedRows: this.rows.length - mapped,
        skippedRows: this.skippedRows,
        uniqueTargets: targets.size,
      },
      warnings: [...this.warnings.values()].sort((a, b) => a.code.localeCompare(b.code)),
      defaultStatuses,
      suggestedName,
    }
  }
}
