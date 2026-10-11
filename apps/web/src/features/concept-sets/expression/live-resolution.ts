import { useEffect } from 'react'
import { create } from 'zustand'
import { findDraft } from '@/lib/drafts/overlay'
import { VocabularyUnavailableError, getVocabularySource, type ResolveResult } from '@/lib/vocabulary'
import { conceptSetKey, useCatalogStore } from '@/stores/catalog-store'
import { useDraftsStore } from '@/stores/drafts-store'
import { expressionKey, sameExpression } from '../lib/expression'
import type { ExpressionItem, ResolvedConcept } from '@data-dictionary/format'

/**
 * Live resolution of an edited expression (the working copy, or the user's
 * draft), with the loaded vocabulary (`VocabularySource.resolve`, resolve.py's
 * algorithm): what the Resolved view, the SQL export and the pinned-version
 * diff show while the repository's resolved list is not the draft's yet. It is
 * never saved: the server recomputes the list at submit; in static mode the
 * resolved file must be regenerated (resolve.py) and proposed too.
 */
export type LiveEntry =
  | { status: 'loading' }
  | { status: 'ready'; result: ResolveResult }
  | { status: 'unavailable' }
  | { status: 'error'; error: string }

const MAX_ENTRIES = 24

interface LiveResolutionState {
  entries: Record<string, LiveEntry>
  /** Resolves `items` once per (set, expression); later calls share the result. */
  resolve: (conceptSetId: number, items: readonly ExpressionItem[]) => Promise<ResolveResult | null>
}

const keyOf = (id: number, items: readonly ExpressionItem[]) => `${id}|${expressionKey(items)}`
const pending = new Map<string, Promise<ResolveResult | null>>()

export const useLiveResolutionStore = create<LiveResolutionState>()((set, get) => ({
  entries: {},
  resolve: (conceptSetId, items) => {
    const key = keyOf(conceptSetId, items)
    const entry = get().entries[key]
    if (entry?.status === 'ready') return Promise.resolve(entry.result)
    const running = pending.get(key)
    if (running) return running
    const put = (value: LiveEntry) => {
      const entries = { ...get().entries, [key]: value }
      const keys = Object.keys(entries)
      for (const old of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete entries[old]
      set({ entries })
    }
    put({ status: 'loading' })
    const promise = getVocabularySource()
      .resolve(items, conceptSetId)
      .then((result) => {
        put({ status: 'ready', result })
        return result
      })
      .catch((error: unknown) => {
        if (error instanceof VocabularyUnavailableError) put({ status: 'unavailable' })
        else put({ status: 'error', error: error instanceof Error ? error.message : String(error) })
        return null
      })
      .finally(() => pending.delete(key))
    pending.set(key, promise)
    return promise
  },
}))

/** The live resolution of `items` (null: nothing to resolve live), started on first use. */
export function useLiveResolution(conceptSetId: number, items: readonly ExpressionItem[] | null): LiveEntry | null {
  const key = items ? keyOf(conceptSetId, items) : null
  const entry = useLiveResolutionStore((s) => (key ? s.entries[key] : undefined))
  const resolve = useLiveResolutionStore((s) => s.resolve)
  useEffect(() => {
    if (items && key) void resolve(conceptSetId, items)
    // `key` stands for `items`: a new array with the same expression is not a new resolution.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conceptSetId, key, resolve])
  if (!items) return null
  return entry ?? { status: 'loading' }
}

/**
 * The expression to resolve live: the shown one, when it differs from the
 * repository's (null when it does not, or no repository version exists to
 * compare and the set has nothing to resolve).
 */
export function liveExpression(
  shown: readonly ExpressionItem[] | null | undefined,
  repository: readonly ExpressionItem[] | null | undefined,
  repositoryKnown: boolean,
): readonly ExpressionItem[] | null {
  if (repositoryKnown && sameExpression(shown, repository)) return null
  return shown ?? []
}

/**
 * The resolved concepts of the user's draft of set `id` when its expression
 * differs from the repository's (null otherwise, or when no vocabulary can
 * resolve it): what a pin update to the draft's version would bring.
 */
export async function draftResolvedConcepts(id: number): Promise<ResolvedConcept[] | null> {
  await useDraftsStore.getState().load()
  const draft = findDraft(useDraftsStore.getState().drafts, 'concept-set', id)
  if (!draft) return null
  await useCatalogStore.getState().loadConceptSet(id)
  const repo = useCatalogStore.getState().conceptSetDetails[conceptSetKey(id)]?.data ?? null
  const items = liveExpression(draft.content.expression?.items, repo?.expression?.items, repo !== null)
  if (!items) return null
  return (await useLiveResolutionStore.getState().resolve(id, items))?.resolvedConcepts ?? null
}
