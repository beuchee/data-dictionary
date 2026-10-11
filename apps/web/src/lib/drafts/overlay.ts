// The v1 local CRUD overlay (legacy/app.js: userConceptSets, modifiedCsIds,
// indicate_hidden_cs…) as pure functions over the catalog and the drafts.
import { conceptSetSummary } from '@/lib/data/catalog'
import { draftEntityId } from './paths'
import type { ConceptSetSummary, Project } from '@/lib/data/types'
import type { Draft, DraftKind, DraftOf } from './types'

/** The draft of `kind` shown under `entityId` (single-file kinds: `entityId` null), if any. */
export function findDraft<K extends DraftKind>(
  drafts: readonly Draft[],
  kind: K,
  entityId: number | null,
): DraftOf<K> | undefined {
  return drafts.find((d) => d.kind === kind && draftEntityId(d) === entityId) as DraftOf<K> | undefined
}

export interface Overlaid<T> {
  items: T[]
  /** Ids shown from a draft (edited or new): the "local changes" badge. */
  draftIds: Set<number>
  /** Ids that only exist as a draft. */
  newIds: Set<number>
}

function overlay<T extends { id: number }>(
  base: readonly T[],
  drafts: readonly Draft[],
  kind: 'concept-set' | 'project',
  hidden: readonly number[],
  fromDraft: (draft: Draft, previous: T | undefined) => T,
): Overlaid<T> {
  const byId = new Map(base.map((item) => [item.id, item]))
  const draftIds = new Set<number>()
  const newIds = new Set<number>()
  const replaced = new Map<number, T>()
  const added: T[] = []
  for (const draft of drafts) {
    if (draft.kind !== kind) continue
    const id = draftEntityId(draft)
    if (id === null) continue
    const previous = byId.get(id)
    const item = fromDraft(draft, previous)
    draftIds.add(id)
    if (previous && draft.targetId !== null) replaced.set(id, item)
    else {
      newIds.add(id)
      added.push(item)
    }
  }
  const hiddenIds = new Set(hidden)
  const items = [...base.map((item) => replaced.get(item.id) ?? item), ...added]
    .filter((item) => !hiddenIds.has(item.id) || draftIds.has(item.id))
    .sort((a, b) => a.id - b.id)
  return { items, draftIds, newIds }
}

/**
 * The concept set list as this user sees it: an edited set shows its draft,
 * a new one is added, and one hidden locally (static-mode delete) is left out
 * unless a draft brings it back. A draft keeps the resolved count of the
 * catalog's version: resolution is not redone by editing.
 */
export function overlayConceptSetSummaries(
  summaries: readonly ConceptSetSummary[],
  drafts: readonly Draft[],
  hidden: readonly number[] = [],
): Overlaid<ConceptSetSummary> {
  return overlay(summaries, drafts, 'concept-set', hidden, (draft, previous) =>
    conceptSetSummary((draft as DraftOf<'concept-set'>).content, previous?.resolvedCount ?? null),
  )
}

/** The project list as this user sees it (same rules as concept sets). */
export function overlayProjects(
  projects: readonly Project[],
  drafts: readonly Draft[],
  hidden: readonly number[] = [],
): Overlaid<Project> {
  return overlay(projects, drafts, 'project', hidden, (draft) => (draft as DraftOf<'project'>).content)
}

/**
 * The next id for something created here: above every id in use (catalog and
 * drafts), the repository's counter (`id_counters.json`, which also covers
 * deleted ids) and the last id this browser handed out. Ids are never reused.
 */
export function nextLocalId(usedIds: Iterable<number>, repoFloor: number | null | undefined, localFloor: number): number {
  let max = 0
  for (const id of usedIds) if (id > max) max = id
  return Math.max(max + 1, repoFloor ?? 0, localFloor)
}
