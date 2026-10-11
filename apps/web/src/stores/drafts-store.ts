import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { isServerMode } from '@/lib/api-client'
import { getDictionarySource } from '@/lib/data'
import { draftEntityId } from '@/lib/drafts/paths'
import { nextLocalId } from '@/lib/drafts/overlay'
import { useAuthStore } from '@/stores/auth-store'
import type { ApiDraftStore } from '@/lib/drafts/api-draft-store'
import type { Draft, DraftContentByKind, DraftKind, DraftOf, DraftStore } from '@/lib/drafts/types'
import type { LoadStatus } from '@/stores/catalog-store'

let storePromise: Promise<DraftStore> | null = null

/**
 * The draft store of this build, loaded on first use: the IndexedDB one pulls
 * in `idb` and the format serializer, which the header showing the drafts
 * count must not drag into the main bundle.
 */
export function getDraftStore(): Promise<DraftStore> {
  storePromise ??= isServerMode()
    ? import('@/lib/drafts/api-draft-store').then((m) => new m.ApiDraftStore())
    : import('@/lib/drafts/local-draft-store').then((m) => new m.LocalDraftStore())
  return storePromise
}

/** Server mode only: the store with `submit`, `gitStatus` and `pull`. */
export async function getApiDraftStore(): Promise<ApiDraftStore> {
  if (!isServerMode()) throw new Error('Submitting drafts needs the API (server mode)')
  return (await getDraftStore()) as ApiDraftStore
}

/** Replace the store (tests). */
export function setDraftStore(store: DraftStore | null): void {
  storePromise = store ? Promise.resolve(store) : null
}

export interface SaveDraftInput<K extends DraftKind> {
  kind: K
  /** The content id it replaces; null for a new concept set / project and for single-file kinds. */
  targetId: number | null
  content: DraftContentByKind[K]
}

type CreatableKind = 'concept-set' | 'project'

interface DraftsState {
  drafts: Draft[]
  status: LoadStatus
  error: string | null
  /** Static mode: repository sets / projects deleted here, hidden like v1 did. */
  hidden: Record<CreatableKind, number[]>
  /** Static mode: the next id this browser hands out, so a discarded draft's id is not reused. */
  localNextIds: Record<CreatableKind, number>

  load: (force?: boolean) => Promise<void>
  /**
   * Saves `content` as this user's draft of that file: updates the draft
   * already open for it (same kind and id), else creates one.
   */
  save: <K extends DraftKind>(input: SaveDraftInput<K>) => Promise<DraftOf<K>>
  discard: (id: string) => Promise<void>
  /** A submitted draft leaves the list (the server dropped it). */
  forget: (id: string) => void
  hide: (kind: CreatableKind, id: number) => void
  unhide: (kind: CreatableKind, id: number) => void
  /** The id of a new concept set / project (provisional in server mode: the server allocates at submit). */
  allocateId: (kind: CreatableKind, usedIds: Iterable<number>, repoFloor?: number | null) => number
  /** `allocateId` above the repository's counters too (`id_counters.json`, static mode). */
  newId: (kind: CreatableKind, usedIds: Iterable<number>) => Promise<number>
  reset: () => void
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sameFile(a: Pick<Draft, 'kind'> & { entityId: number | null }, b: Draft): boolean {
  return a.kind === b.kind && a.entityId === draftEntityId(b)
}

export const useDraftsStore = create<DraftsState>()(
  persist(
    (set, get) => {
      let generation = 0
      let pending: Promise<void> | null = null

      return {
        drafts: [],
        status: 'idle',
        error: null,
        hidden: { 'concept-set': [], project: [] },
        localNextIds: { 'concept-set': 0, project: 0 },

        load: (force = false) => {
          const { status } = get()
          if (!force && (status === 'ready' || status === 'loading')) return pending ?? Promise.resolve()
          // Server mode without an account has no drafts (and no right to ask).
          if (isServerMode() && !useAuthStore.getState().user) {
            set({ drafts: [], status: 'ready', error: null })
            return Promise.resolve()
          }
          const gen = generation
          set({ status: 'loading', error: null })
          pending = getDraftStore()
            .then((store) => store.list())
            .then((drafts) => {
              if (gen === generation) set({ drafts, status: 'ready', error: null })
            })
            .catch((error) => {
              if (gen === generation) set({ status: 'error', error: message(error) })
            })
            .finally(() => {
              pending = null
            })
          return pending
        },

        save: async <K extends DraftKind>({ kind, targetId, content }: SaveDraftInput<K>) => {
          const store = await getDraftStore()
          const entityId =
            targetId ?? (kind === 'concept-set' || kind === 'project' ? (content as { id: number }).id : null)
          const existing = get().drafts.find((d) => sameFile({ kind, entityId }, d))
          const saved = existing
            ? await store.update<K>(existing.id, content)
            : await store.create<K>({ kind, targetId, content })
          set({ drafts: [saved as Draft, ...get().drafts.filter((d) => d.id !== saved.id)] })
          return saved
        },

        discard: async (id) => {
          const store = await getDraftStore()
          await store.remove(id)
          set({ drafts: get().drafts.filter((d) => d.id !== id) })
        },

        forget: (id) => set({ drafts: get().drafts.filter((d) => d.id !== id) }),

        hide: (kind, id) => {
          const hidden = get().hidden
          if (hidden[kind].includes(id)) return
          set({ hidden: { ...hidden, [kind]: [...hidden[kind], id] } })
        },

        unhide: (kind, id) => {
          const hidden = get().hidden
          set({ hidden: { ...hidden, [kind]: hidden[kind].filter((x) => x !== id) } })
        },

        allocateId: (kind, usedIds, repoFloor) => {
          const draftIds = get()
            .drafts.filter((d) => d.kind === kind)
            .map(draftEntityId)
            .filter((id): id is number => id !== null)
          const id = nextLocalId([...usedIds, ...draftIds, ...get().hidden[kind]], repoFloor, get().localNextIds[kind])
          set({ localNextIds: { ...get().localNextIds, [kind]: id + 1 } })
          return id
        },

        newId: async (kind, usedIds) => {
          let floors: { conceptSet: number | null; project: number | null } | undefined
          try {
            floors = await getDictionarySource().getNextIds?.()
          } catch (error) {
            console.warn('Could not read the repository id counters', error)
          }
          const floor = kind === 'concept-set' ? floors?.conceptSet : floors?.project
          return get().allocateId(kind, usedIds, floor)
        },

        reset: () => {
          generation++
          pending = null
          set({ drafts: [], status: 'idle', error: null })
        },
      }
    },
    {
      name: 'dd-local-drafts',
      partialize: (s) => ({ hidden: s.hidden, localNextIds: s.localNextIds }),
    },
  ),
)

// Drafts belong to an account: follow logins, logouts and account switches.
if (isServerMode()) {
  useAuthStore.subscribe((state, previous) => {
    if (state.user?.id === previous.user?.id) return
    useDraftsStore.getState().reset()
    void useDraftsStore.getState().load()
  })
}
