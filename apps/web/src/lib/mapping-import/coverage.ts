// What a stored import contributes to coverage. No parser dependency: the
// coverage page imports this without pulling in the XLSX / ZIP readers.
import type { MappingRow } from './types'

/** Statuses counted, lower-case; null = all. A row with no status always counts. */
export type StatusFilter = readonly string[] | null

function counts(row: MappingRow, statuses: StatusFilter): boolean {
  return statuses === null || row.status === undefined || statuses.includes(row.status)
}

/** The mapped target ids (0 excluded) of the rows the filter keeps. */
export function coverageTargets(rows: readonly MappingRow[], statuses: StatusFilter = null): Set<number> {
  const out = new Set<number>()
  for (const r of rows) if (r.targetConceptId !== 0 && counts(r, statuses)) out.add(r.targetConceptId)
  return out
}

/** Rows per status (`''` for rows without one), most frequent first. */
export function statusCounts(rows: readonly MappingRow[]): [string, number][] {
  const map = new Map<string, number>()
  for (const r of rows) map.set(r.status ?? '', (map.get(r.status ?? '') ?? 0) + 1)
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

export type SourceRef = Omit<MappingRow, 'targetConceptId'>

/** The source codes mapped to each target, for the rows the filter keeps. */
export function sourcesByTarget(rows: readonly MappingRow[], statuses: StatusFilter = null): Map<number, SourceRef[]> {
  const out = new Map<number, SourceRef[]>()
  for (const r of rows) {
    if (r.targetConceptId === 0 || !counts(r, statuses)) continue
    const { targetConceptId, ...source } = r
    const list = out.get(targetConceptId)
    if (list) list.push(source)
    else out.set(targetConceptId, [source])
  }
  return out
}
