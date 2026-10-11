// Adapted from linkr@1310cf4a4 apps/web/src/lib/fuzzy-search.ts
// Only the client-side matcher: the DuckDB SQL builder stays in Linkr until a
// vocabulary search needs it. `fuzzyRank` and `fuzzyFilter` are added here so a
// list can order its hits by match quality, as v1's `fuzzyFilter` did.

/** JW threshold for the fuzzy tier, tuned in Linkr for recall. */
export const JW_FUZZY_THRESHOLD = 0.75

/** Strip diacritics + lowercase. Mirrors DuckDB `strip_accents(LOWER(...))`. */
function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Jaro-Winkler similarity in [0, 1]. Same algorithm as DuckDB's. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1
  if (!a.length || !b.length) return 0
  const matchWindow = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1)
  const aMatches = new Array(a.length).fill(false)
  const bMatches = new Array(b.length).fill(false)
  let matches = 0
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchWindow)
    const end = Math.min(i + matchWindow + 1, b.length)
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue
      aMatches[i] = true
      bMatches[j] = true
      matches++
      break
    }
  }
  if (!matches) return 0
  let transpositions = 0
  let k = 0
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue
    while (!bMatches[k]) k++
    if (a[i] !== b[k]) transpositions++
    k++
  }
  const m = matches
  const jaro = (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3
  // Winkler prefix bonus (up to 4 chars, scale 0.1).
  let prefix = 0
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++
    else break
  }
  return jaro + prefix * 0.1 * (1 - jaro)
}

/**
 * How well `value` matches `query`, lower is better, null for no match. Tiers:
 * 0 exact, 1 prefix, 2 every query word is a substring, 3–4 whole-string
 * Jaro-Winkler ≥ threshold (3 + distance). Accent-folded, case-insensitive.
 * An empty query ranks everything 0.
 */
export function fuzzyRank(value: string | null | undefined, query: string): number | null {
  const q = query.trim()
  if (!q) return 0
  if (value == null) return null
  const v = fold(value)
  const fq = fold(q)
  if (v === fq) return 0
  if (v.startsWith(fq)) return 1
  const words = fq.split(/\s+/).filter(Boolean)
  if (words.every((w) => v.includes(w))) return 2
  const similarity = jaroWinkler(v, fq)
  return similarity >= JW_FUZZY_THRESHOLD ? 3 + (1 - similarity) : null
}

/** Canonical text matcher: exact, prefix, substring (every word), or Jaro-Winkler ≥ 0.75. */
export function fuzzyTextMatch(value: string | null | undefined, query: string): boolean {
  return fuzzyRank(value, query) !== null
}

/**
 * The items any of whose texts match `query`, best match first (stable within a
 * rank). An empty query returns the items unchanged.
 */
export function fuzzyFilter<T>(items: T[], query: string, texts: (item: T) => (string | null | undefined)[]): T[] {
  if (!query.trim()) return items
  const hits: { item: T; rank: number; index: number }[] = []
  items.forEach((item, index) => {
    let best: number | null = null
    for (const text of texts(item)) {
      const rank = fuzzyRank(text, query)
      if (rank !== null && (best === null || rank < best)) best = rank
    }
    if (best !== null) hits.push({ item, rank: best, index })
  })
  hits.sort((a, b) => a.rank - b.rank || a.index - b.index)
  return hits.map((h) => h.item)
}
