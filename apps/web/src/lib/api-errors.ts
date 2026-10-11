/**
 * The body fields a FastAPI 422 names (`{detail: [{loc: ["body", "orcid"], …}]}`),
 * read from the raw body text an `ApiError` carries. Empty for anything else.
 */
export function validationErrorFields(body: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return []
  }
  const detail = (parsed as { detail?: unknown } | null)?.detail
  if (!Array.isArray(detail)) return []
  return detail
    .map((d) => (d as { loc?: unknown })?.loc)
    .filter((loc): loc is unknown[] => Array.isArray(loc) && loc[0] === 'body' && typeof loc[1] === 'string')
    .map((loc) => loc[1] as string)
}
