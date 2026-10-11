/**
 * A content date (`2025-01-15`, or a full ISO timestamp) in the UI language.
 * Date-only values are read in UTC, so they never shift a day with the time zone.
 */
export function formatContentDate(value: string | null | undefined, lang: string): string {
  if (!value) return ''
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const date = new Date(dateOnly ? `${value}T00:00:00Z` : value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(lang, { dateStyle: 'medium', ...(dateOnly ? { timeZone: 'UTC' } : {}) }).format(date)
}
