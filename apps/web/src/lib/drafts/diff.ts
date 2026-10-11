import { RawNumber, type ConceptSet, type ExpressionItem } from '@data-dictionary/format'

type Json = unknown

const isObject = (v: Json): v is Record<string, Json> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof RawNumber)

/** Deep equality of parsed content; `1.0` and `1` are the same value (only the lexeme differs). */
export function contentEqual(a: Json, b: Json): boolean {
  if (a instanceof RawNumber || b instanceof RawNumber) {
    return (typeof a === 'number' || a instanceof RawNumber) && (typeof b === 'number' || b instanceof RawNumber)
      ? Number(a) === Number(b)
      : false
  }
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => contentEqual(v, b[i]))
  }
  if (isObject(a) && isObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of keys) {
      // A key holding `undefined` is not written: same as absent.
      if (!contentEqual(a[k], b[k])) return false
    }
    return true
  }
  return false
}

/**
 * Dotted paths (`metadata.translations.fr.name`, `expression.items[3]`) where
 * `next` differs from `base`, at most `maxDepth` levels deep; deeper changes
 * are reported at that depth. Empty when they are equal.
 */
export function changedPaths(base: Json, next: Json, maxDepth = 4): string[] {
  const out: string[] = []
  const walk = (a: Json, b: Json, path: string, depth: number) => {
    if (contentEqual(a, b)) return
    if (depth >= maxDepth) {
      out.push(path)
      return
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      const n = Math.max(a.length, b.length)
      for (let i = 0; i < n; i++) walk(a[i], b[i], `${path}[${i}]`, depth + 1)
      return
    }
    if (isObject(a) && isObject(b)) {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)])
      for (const k of keys) walk(a[k], b[k], path ? `${path}.${k}` : k, depth + 1)
      return
    }
    out.push(path)
  }
  walk(base, next, '', 0)
  return out
}

/**
 * Whether `next` only appends entries to `base`'s `metadata.reviews` (every
 * existing review untouched, at least one added, nothing else changed). Such a
 * draft can be submitted with `reviews:write` alone, so it must stay exactly
 * the base plus the new reviews: no provenance stamp.
 */
export function isReviewsOnlyChange(base: ConceptSet, next: ConceptSet): boolean {
  const before = Array.isArray(base.metadata?.reviews) ? base.metadata.reviews : []
  const after = Array.isArray(next.metadata?.reviews) ? next.metadata.reviews : []
  if (after.length <= before.length) return false
  if (!before.every((r, i) => contentEqual(r, after[i]))) return false
  const strip = (cs: ConceptSet) => ({ ...cs, metadata: { ...cs.metadata, reviews: undefined } })
  return contentEqual(strip(base), strip(next))
}

export interface ExpressionChange {
  /** Concept ids of items only in `next`. */
  added: number[]
  /** Concept ids of items only in `base`. */
  removed: number[]
  /** Concept ids whose exclude / descendants / mapped flags changed. */
  modified: number[]
  /** Whether the change can drop concepts from the resolved list. */
  narrows: boolean
  /** Whether the change can add concepts to the resolved list. */
  broadens: boolean
}

const items = (cs: ConceptSet): ExpressionItem[] =>
  Array.isArray(cs.expression?.items) ? cs.expression.items : []

/**
 * The expression items `next` adds, removes or re-flags compared with `base`,
 * keyed by concept id, and which way that moves the resolved list: an included
 * item (or descendants / mapped on one) that goes away narrows it, as does a
 * new exclusion; the reverse broadens it.
 */
export function expressionChange(base: ConceptSet, next: ConceptSet): ExpressionChange {
  const byId = (list: ExpressionItem[]) => new Map(list.map((i) => [i.concept?.conceptId, i]))
  const before = byId(items(base))
  const after = byId(items(next))
  const change: ExpressionChange = { added: [], removed: [], modified: [], narrows: false, broadens: false }
  // An included item contributes concepts; an excluded one takes them away.
  const mark = (item: ExpressionItem, gained: boolean) => {
    if (gained !== !!item.isExcluded) change.broadens = true
    else change.narrows = true
  }
  for (const [id, item] of after) {
    const old = before.get(id)
    if (!old) {
      change.added.push(id)
      mark(item, true)
      continue
    }
    if (!!old.isExcluded !== !!item.isExcluded) {
      change.modified.push(id)
      if (item.isExcluded) change.narrows = true
      else change.broadens = true
      continue
    }
    let flagged = false
    for (const flag of ['includeDescendants', 'includeMapped'] as const) {
      if (!!old[flag] === !!item[flag]) continue
      flagged = true
      mark(item, !!item[flag])
    }
    if (flagged) change.modified.push(id)
  }
  for (const [id, item] of before) {
    if (after.has(id)) continue
    change.removed.push(id)
    mark(item, false)
  }
  return change
}
