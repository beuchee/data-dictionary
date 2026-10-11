/** `1536` → `1.5 KB` (base 1024, one decimal under 10). */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1
  return `${value.toFixed(digits)} ${units[unit]}`
}

/** Percentage of `done` over `total`, 0–100, 0 when the total is unknown. */
export function percent(done: number, total: number): number {
  if (!total || total < 0) return 0
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)))
}

/** The Athena page of a concept. */
export const athenaUrl = (conceptId: number) => `https://athena.ohdsi.org/search-terms/terms/${conceptId}`
