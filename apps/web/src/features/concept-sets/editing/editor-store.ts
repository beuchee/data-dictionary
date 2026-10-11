import { create } from 'zustand'
import { contentEqual } from '@/lib/drafts/diff'
import type { ConceptSet } from '@data-dictionary/format'

type Flush = () => void

interface ConceptSetEditorState {
  /** The set being edited (one at a time); null when not editing. */
  id: number | null
  /** What the edit started from: the user's draft, else the repository's version. */
  original: ConceptSet | null
  working: ConceptSet | null
  /** A set that only exists as this draft (created here, not in the repository yet). */
  isNew: boolean
  /** Debounced editors (Monaco) register their flush, run before reading `working`. */
  flushers: Set<Flush>
  /** Editors whose text can't be applied (invalid JSON…), by editor: saving waits for them. */
  errors: Record<string, string>

  start: (conceptSet: ConceptSet, options?: { isNew?: boolean }) => void
  /** Applies `change` to the working copy. */
  update: (change: (cs: ConceptSet) => ConceptSet) => void
  stop: () => void
  setError: (editor: string, error: string | null) => void
  registerFlush: (flush: Flush) => () => void
  /** Commits pending keystrokes, then returns the working copy. */
  flush: () => ConceptSet | null
}

/**
 * The concept set edit session of the detail page: a working copy that the
 * metadata, status and version dialogs and the Comments / Statistics editors
 * change, saved as a draft in one go. The expression editor (Concepts tab)
 * writes `expression.items` through `update` too.
 */
export const useConceptSetEditor = create<ConceptSetEditorState>()((set, get) => ({
  id: null,
  original: null,
  working: null,
  isNew: false,
  flushers: new Set(),
  errors: {},

  start: (conceptSet, options = {}) =>
    set({ id: conceptSet.id, original: conceptSet, working: conceptSet, isNew: !!options.isNew, errors: {} }),

  update: (change) => {
    const { working } = get()
    if (working) set({ working: change(working) })
  },

  stop: () => set({ id: null, original: null, working: null, isNew: false, errors: {} }),

  setError: (editor, error) => {
    const errors = { ...get().errors }
    if (error) errors[editor] = error
    else delete errors[editor]
    set({ errors })
  },

  registerFlush: (flush) => {
    get().flushers.add(flush)
    return () => {
      get().flushers.delete(flush)
    }
  },

  flush: () => {
    for (const f of get().flushers) f()
    return get().working
  },
}))

/** Whether the working copy differs from what the edit started from. */
export function useEditorDirty(): boolean {
  return useConceptSetEditor((s) => s.working !== s.original && !contentEqual(s.original, s.working))
}
