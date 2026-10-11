// Ported from legacy/concept-sets.js (resolveExpressionViaDuckDB, doOptimizeExpression,
// runTopDownOptimization, runBottomUpOptimization, evaluateParentCandidate,
// buildProposal). Same steps and the same choices; the vocabulary is read through
// `OptimizeLookup` (VocabularySource in the app) instead of raw SQL, and ties
// between equally good parents go to the lowest concept id (v1's SQL left them
// in no particular order). Checked against goldens produced by running v1's own
// functions on the vocabulary fixture (scripts/generate-optimize-goldens.mjs).
import { itemFromConcept } from './expression'
import type { AncestorCandidate, DescendantPair, OmopConcept } from '@/lib/vocabulary'
import type { ExpressionItem } from '@data-dictionary/format'

/** What the optimizer reads from the vocabulary (a subset of `VocabularySource`). */
export interface OptimizeLookup {
  getDescendantPairs(ancestorIds: readonly number[], withinIds?: readonly number[] | null): Promise<DescendantPair[]>
  getMappedIds(ids: readonly number[]): Promise<number[]>
  getAncestorCandidates(ids: readonly number[], query?: { maxDepth?: number; limit?: number }): Promise<AncestorCandidate[]>
  getConcepts(ids: readonly number[]): Promise<OmopConcept[]>
}

export interface OptimizeChange {
  action: 'removed' | 'added'
  id: number
  name: string
  isExcluded: boolean
  includeDescendants: boolean
  includeMapped: boolean
}

export interface OptimizeStep {
  items: ExpressionItem[]
  changes: OptimizeChange[]
}

export interface OptimizeResult extends OptimizeStep {
  /** The resolved ids before and after (v1's check that nothing changed). */
  before: Set<number>
  after: Set<number>
  /** Resolved ids the optimized expression gains / loses (both empty when `identical`). */
  gained: number[]
  lost: number[]
  identical: boolean
}

const idOf = (item: ExpressionItem) => item.concept.conceptId

function change(action: OptimizeChange['action'], item: ExpressionItem): OptimizeChange {
  return {
    action,
    id: idOf(item),
    name: item.concept.conceptName,
    isExcluded: !!item.isExcluded,
    includeDescendants: !!item.includeDescendants,
    includeMapped: !!item.includeMapped,
  }
}

async function descendantsOf(lookup: OptimizeLookup, ids: number[]): Promise<number[]> {
  if (!ids.length) return []
  return (await lookup.getDescendantPairs(ids)).map((p) => p.descendantId)
}

async function expandIds(lookup: OptimizeLookup, items: readonly ExpressionItem[]): Promise<Set<number>> {
  const all = new Set(items.map(idOf))
  const desc = items.filter((i) => i.includeDescendants).map(idOf)
  const mapped = items.filter((i) => i.includeMapped).map(idOf)
  const [d, m] = await Promise.all([
    descendantsOf(lookup, desc),
    // v1 read the mapping as best effort (the browser may lack the table).
    mapped.length ? lookup.getMappedIds(mapped).catch(() => [] as number[]) : Promise.resolve([] as number[]),
  ])
  for (const id of d) all.add(id)
  for (const id of m) all.add(id)
  return all
}

/**
 * The resolved ids of `items` (v1's `resolveExpressionViaDuckDB`): included
 * minus excluded, each side its ids plus descendants and mapped. Unlike the
 * full resolver it keeps ids the vocabulary lacks: it compares expressions.
 */
export async function resolveIds(lookup: OptimizeLookup, items: readonly ExpressionItem[]): Promise<Set<number>> {
  const included = items.filter((i) => !i.isExcluded)
  const excluded = items.filter((i) => i.isExcluded)
  if (!included.length) return new Set()
  const ids = await expandIds(lookup, included)
  if (excluded.length) for (const id of await expandIds(lookup, excluded)) ids.delete(id)
  return ids
}

// --- Top-down --------------------------------------------------------------------

/**
 * Drops items already covered by another item of the same side (included or
 * excluded) that has `includeDescendants`, unless the covered item maps and its
 * ancestor does not (mapping would widen the result).
 */
export async function topDown(lookup: OptimizeLookup, items: readonly ExpressionItem[]): Promise<OptimizeStep> {
  const included = items.filter((i) => !i.isExcluded)
  const excluded = items.filter((i) => i.isExcluded)

  const findRedundant = async (partition: ExpressionItem[]): Promise<Set<number>> => {
    const parents = partition.filter((i) => i.includeDescendants).map(idOf)
    const redundant = new Set<number>()
    if (!parents.length) return redundant
    const pairs = await lookup.getDescendantPairs(parents, partition.map(idOf))
    for (const { ancestorId, descendantId } of pairs) {
      const parent = partition.find((i) => idOf(i) === ancestorId)
      const child = partition.find((i) => idOf(i) === descendantId)
      if (!parent || !child || ancestorId === descendantId) continue
      if (!child.includeMapped || parent.includeMapped) redundant.add(descendantId)
    }
    return redundant
  }

  const [a, b] = await Promise.all([findRedundant(included), findRedundant(excluded)])
  // As v1: a concept redundant on one side goes from both (an id appears once per expression).
  const redundant = new Set([...a, ...b])
  if (!redundant.size) return { items: [...items], changes: [] }
  const changes: OptimizeChange[] = []
  const kept = items.filter((item) => {
    if (!redundant.has(idOf(item))) return true
    changes.push(change('removed', item))
    return false
  })
  return { items: kept, changes }
}

// --- Bottom-up -------------------------------------------------------------------

interface Proposal extends OptimizeStep {
  netGain: number
}

async function evaluateCandidate(
  lookup: OptimizeLookup,
  parent: AncestorCandidate,
  included: ExpressionItem[],
  excluded: ExpressionItem[],
): Promise<Proposal | null> {
  const parentId = parent.conceptId
  const descendants = await descendantsOf(lookup, [parentId])
  const all = new Set(descendants)
  const coveredIncluded = included.filter((i) => all.has(idOf(i)))
  if (coveredIncluded.length < 2) return null
  const coveredExcluded = excluded.filter((i) => all.has(idOf(i)))
  const uncoveredIncluded = included.filter((i) => !all.has(idOf(i)))
  const uncoveredExcluded = excluded.filter((i) => !all.has(idOf(i)))

  // The parent with its descendants brings in all of them: whatever the covered
  // items did not resolve to must then be excluded explicitly (the parent too).
  const coveredResolved = await resolveIds(lookup, [...coveredIncluded, ...coveredExcluded])
  const needExclude = [parentId, ...descendants.filter((id) => id !== parentId)].filter((id) => !coveredResolved.has(id))
  const netGain = coveredIncluded.length + coveredExcluded.length - (1 + needExclude.length)
  if (netGain < 1) return null

  const concepts = needExclude.length ? await lookup.getConcepts([...new Set(needExclude)]) : []
  const changes: OptimizeChange[] = [
    ...coveredIncluded.map((i) => change('removed', { ...i, isExcluded: false })),
    ...coveredExcluded.map((i) => change('removed', { ...i, isExcluded: true })),
  ]
  const parentItem = itemFromConcept(parent, { isExcluded: false, includeDescendants: true, includeMapped: false })
  changes.push(change('added', parentItem))
  const excludeItems = concepts
    .sort((x, y) => x.conceptId - y.conceptId)
    .map((c) => itemFromConcept(c, { isExcluded: true, includeDescendants: false, includeMapped: false }))
  for (const item of excludeItems) changes.push(change('added', item))
  return {
    items: [...uncoveredIncluded, ...uncoveredExcluded, parentItem, ...excludeItems],
    changes,
    netGain,
  }
}

/**
 * Looks for one ancestor (up to 5 levels above, among the 30 covering the most
 * included items) that, with its descendants and a few exclusions, replaces
 * more items than it adds; keeps the best (largest net gain) if any.
 */
export async function bottomUp(lookup: OptimizeLookup, items: readonly ExpressionItem[]): Promise<OptimizeStep> {
  const included = items.filter((i) => !i.isExcluded)
  const excluded = items.filter((i) => i.isExcluded)
  const unchanged = { items: [...items], changes: [] }
  if (included.length < 2) return unchanged

  let candidates: AncestorCandidate[]
  try {
    candidates = await lookup.getAncestorCandidates(included.map(idOf), { maxDepth: 5, limit: 30 })
  } catch {
    return unchanged
  }
  let best: Proposal | null = null
  for (const candidate of candidates) {
    const proposal = await evaluateCandidate(lookup, candidate, included, excluded)
    if (proposal && (!best || proposal.netGain > best.netGain)) best = proposal
  }
  return best ? { items: best.items, changes: best.changes } : unchanged
}

/**
 * v1's "Optimize expression": top-down redundancy removal, then a bottom-up
 * parent replacement, then a check that the resolved ids are unchanged (they
 * can differ when the vocabulary lacks mapping rows: the dialog shows it).
 */
export async function optimizeExpression(lookup: OptimizeLookup, items: readonly ExpressionItem[]): Promise<OptimizeResult> {
  const before = await resolveIds(lookup, items)
  const afterTopDown = await topDown(lookup, items)
  const afterBottomUp = await bottomUp(lookup, afterTopDown.items)
  const changes = [...afterTopDown.changes, ...afterBottomUp.changes]
  if (!changes.length) {
    return { items: [...items], changes, before, after: before, gained: [], lost: [], identical: true }
  }
  const after = await resolveIds(lookup, afterBottomUp.items)
  const gained = [...after].filter((id) => !before.has(id)).sort((a, b) => a - b)
  const lost = [...before].filter((id) => !after.has(id)).sort((a, b) => a - b)
  return { items: afterBottomUp.items, changes, before, after, gained, lost, identical: !gained.length && !lost.length }
}
