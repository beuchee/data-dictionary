import { csvField } from '@/lib/export/project-csv'

/** A query result as CSV (v1's export): every cell quoted, formula triggers defused, BOM for Excel. */
export function resultCsv(columns: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const lines = [columns.map(csvField).join(',')]
  for (const r of rows) lines.push(columns.map((_, i) => csvField(r[i])).join(','))
  return `\uFEFF${lines.join('\n')}\n`
}
