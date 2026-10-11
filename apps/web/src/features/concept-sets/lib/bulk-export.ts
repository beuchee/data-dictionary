// Ported from legacy/concept-sets.js (executeBulkExport, executeBulkExportByCategory).
import { serialize, type ConceptSet } from '@data-dictionary/format'
import type { ConceptSetSummary } from '@/lib/data'

export type BulkExportMode = 'selected' | 'category' | 'all'

/** The ids a bulk export covers, in id order. */
export function bulkExportIds(
  summaries: readonly ConceptSetSummary[],
  mode: BulkExportMode,
  options: { selected?: ReadonlySet<number>; category?: string; lang: string },
): number[] {
  const ids = summaries
    .filter((s) => {
      if (mode === 'selected') return options.selected?.has(s.id) ?? false
      if (mode === 'category') return (s.translations[options.lang]?.category ?? '') === (options.category ?? '')
      return true
    })
    .map((s) => s.id)
  return ids.sort((a, b) => a - b)
}

/** v1's file names: `concept_sets_all.json`, `concept_sets_selected.json`, `concept_sets_<category>.json`. */
export function bulkExportFilename(mode: BulkExportMode, category = ''): string {
  if (mode === 'category') return `concept_sets_${category.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()}.json`
  return `concept_sets_${mode}.json`
}

/** The export: a JSON array of the sets' files, number lexemes kept. */
export function bulkExportJson(conceptSets: readonly ConceptSet[]): string {
  return serialize(conceptSets)
}

/**
 * `load` for each id, `concurrency` at a time, in id order; sets that fail or
 * do not exist are left out and counted.
 */
export async function loadAll(
  ids: readonly number[],
  load: (id: number) => Promise<ConceptSet | null>,
  concurrency = 8,
): Promise<{ conceptSets: ConceptSet[]; missing: number }> {
  const results: (ConceptSet | null)[] = new Array(ids.length).fill(null)
  let next = 0
  const worker = async () => {
    while (next < ids.length) {
      const i = next++
      try {
        results[i] = await load(ids[i])
      } catch {
        results[i] = null
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker))
  const conceptSets = results.filter((cs): cs is ConceptSet => cs !== null)
  return { conceptSets, missing: ids.length - conceptSets.length }
}
