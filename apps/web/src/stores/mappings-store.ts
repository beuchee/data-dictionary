import { create } from 'zustand'
import { getDictionarySource, type DictionarySource } from '@/lib/data'
import { getMappingSource, type MappingImportDetail, type MappingImportSummary, type MappingSource, type NewMappingImport } from '@/lib/mappings'
import { IDLE, type Resource } from './catalog-store'

/** Key of a concept set at a version ('' = current). */
export function pinKey(id: number, version: string | undefined): string {
  return `${id}@${version ?? ''}`
}

// Concurrent fetches of resolved lists (each can be a forge raw request).
const CONCURRENCY = 6

interface MappingsState {
  imports: Resource<MappingImportSummary[]>
  details: Record<string, Resource<MappingImportDetail | null>>
  /**
   * The resolved concept ids of each concept set at a pinned version, for the
   * coverage evaluation (ids only: projects pin hundreds of sets). null = the
   * list does not exist (unknown set, version never snapshotted).
   */
  resolvedIds: Record<string, Resource<number[] | null>>
  loadImports: (force?: boolean) => Promise<void>
  loadImport: (id: string) => Promise<void>
  createImport: (input: NewMappingImport) => Promise<MappingImportSummary>
  removeImport: (id: string) => Promise<void>
  /** Fetch the resolved ids of every `{id, version}` not yet loaded. */
  loadResolvedIds: (entries: readonly { id: number; version?: string }[]) => Promise<void>
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createMappingsStore(
  getSource: () => MappingSource = getMappingSource,
  getDictionary: () => DictionarySource = getDictionarySource,
) {
  return create<MappingsState>()((set, get) => {
    let importsCall: Promise<void> | null = null
    const detailCalls = new Map<string, Promise<void>>()
    const putDetail = (id: string, r: Resource<MappingImportDetail | null>) =>
      set({ details: { ...get().details, [id]: r } })

    return {
      imports: IDLE,
      details: {},
      resolvedIds: {},

      loadImports: (force = false) => {
        const { status } = get().imports
        if (!force && (status === 'ready' || status === 'loading')) return importsCall ?? Promise.resolve()
        set({ imports: { ...get().imports, status: 'loading', error: null } })
        importsCall = getSource()
          .list()
          .then((data) => set({ imports: { data, status: 'ready', error: null } }))
          .catch((error) => set({ imports: { data: get().imports.data, status: 'error', error: message(error) } }))
          .finally(() => (importsCall = null))
        return importsCall
      },

      loadImport: (id) => {
        const current = get().details[id]
        if (current && current.status !== 'error') return detailCalls.get(id) ?? Promise.resolve()
        putDetail(id, { data: null, status: 'loading', error: null })
        const call = getSource()
          .get(id)
          .then((data) => putDetail(id, { data, status: 'ready', error: null }))
          .catch((error) => putDetail(id, { data: null, status: 'error', error: message(error) }))
          .finally(() => detailCalls.delete(id))
        detailCalls.set(id, call)
        return call
      },

      createImport: async (input) => {
        const created = await getSource().create(input)
        await get().loadImports(true)
        return created
      },

      removeImport: async (id) => {
        await getSource().remove(id)
        const details = { ...get().details }
        delete details[id]
        set({ details })
        await get().loadImports(true)
      },

      loadResolvedIds: async (entries) => {
        const todo = [...new Map(entries.map((e) => [pinKey(e.id, e.version), e])).values()].filter(
          (e) => !get().resolvedIds[pinKey(e.id, e.version)],
        )
        if (todo.length === 0) return
        const loading = { ...get().resolvedIds }
        for (const e of todo) loading[pinKey(e.id, e.version)] = { data: null, status: 'loading', error: null }
        set({ resolvedIds: loading })
        let next = 0
        const worker = async () => {
          while (next < todo.length) {
            const e = todo[next++]
            const key = pinKey(e.id, e.version)
            let r: Resource<number[] | null>
            try {
              const page = await getDictionary().getResolved(e.id, e.version ? { version: e.version } : {})
              r = { data: page ? page.resolvedConcepts.map((c) => c.conceptId) : null, status: 'ready', error: null }
            } catch (error) {
              r = { data: null, status: 'error', error: message(error) }
            }
            set({ resolvedIds: { ...get().resolvedIds, [key]: r } })
          }
        }
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker))
      },
    }
  })
}

export const useMappingsStore = createMappingsStore()
