import { create } from 'zustand'
import { getDictionarySource } from '@/lib/data'
import type {
  ConceptSet,
  ConceptSetSummary,
  ConceptSetVersions,
  DictionarySource,
  MappingRecommendations,
  Project,
  RecommendedUnit,
  ResolvedPage,
  ResolvedQuery,
  UnitConversion,
} from '@/lib/data'

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface Resource<T> {
  data: T | null
  status: LoadStatus
  /** The failure message, for a degraded state; null unless `status` is `error`. */
  error: string | null
}

export const IDLE: Resource<never> = { data: null, status: 'idle', error: null }

// Resolved pages can weigh megabytes: keep only the most recent ones.
const MAX_RESOLVED_ENTRIES = 20

export function conceptSetKey(id: number, version?: string): string {
  return version ? `${id}@${version}` : `${id}`
}

export function resolvedKey(id: number, query: ResolvedQuery = {}): string {
  const search = query.search?.trim().toLowerCase() ?? ''
  return `${conceptSetKey(id, query.version)}?${search}&${query.offset ?? 0}&${query.limit ?? ''}`
}

type ListKey = 'conceptSets' | 'projects' | 'recommendedUnits' | 'unitConversions' | 'mappingRecommendations'

interface CatalogState {
  conceptSets: Resource<ConceptSetSummary[]>
  projects: Resource<Project[]>
  recommendedUnits: Resource<RecommendedUnit[]>
  unitConversions: Resource<UnitConversion[]>
  /** `data: null` + `ready` = the instance has none. */
  mappingRecommendations: Resource<MappingRecommendations>
  /** By `conceptSetKey(id, version)`; `data: null` + `ready` = not found. */
  conceptSetDetails: Record<string, Resource<ConceptSet | null>>
  /** By concept set id (as a string). */
  conceptSetVersions: Record<string, Resource<ConceptSetVersions | null>>
  /** By `resolvedKey(id, query)`. */
  resolved: Record<string, Resource<ResolvedPage | null>>

  loadConceptSets: (force?: boolean) => Promise<void>
  loadProjects: (force?: boolean) => Promise<void>
  loadRecommendedUnits: (force?: boolean) => Promise<void>
  loadUnitConversions: (force?: boolean) => Promise<void>
  loadMappingRecommendations: (force?: boolean) => Promise<void>
  loadConceptSet: (id: number, version?: string) => Promise<void>
  loadConceptSetVersions: (id: number) => Promise<void>
  loadResolved: (id: number, query?: ResolvedQuery) => Promise<void>
  /** Forget everything (logout, or after the content changed). */
  reset: () => void
}

const INITIAL = {
  conceptSets: IDLE,
  projects: IDLE,
  recommendedUnits: IDLE,
  unitConversions: IDLE,
  mappingRecommendations: IDLE,
  conceptSetDetails: {},
  conceptSetVersions: {},
  resolved: {},
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A catalog store over `source`; the app uses the one bound to `getDictionarySource()`. */
export function createCatalogStore(getSource: () => DictionarySource) {
  // In-flight requests by resource key, so concurrent callers share one call.
  const inFlight = new Map<string, Promise<void>>()
  // Bumped by reset(): a response to a request made before it is dropped.
  let generation = 0

  return create<CatalogState>()((set, get) => {
    function once(key: string, run: () => Promise<void>): Promise<void> {
      const pending = inFlight.get(key)
      if (pending) return pending
      const promise = run().finally(() => inFlight.delete(key))
      inFlight.set(key, promise)
      return promise
    }

    function loadList<K extends ListKey>(
      key: K,
      fetcher: (source: DictionarySource) => Promise<CatalogState[K]['data']>,
      force = false,
    ): Promise<void> {
      const status = get()[key].status
      if (!force && (status === 'ready' || status === 'loading')) return inFlight.get(key) ?? Promise.resolve()
      return once(key, async () => {
        const gen = generation
        set({ [key]: { ...get()[key], status: 'loading', error: null } } as Partial<CatalogState>)
        try {
          const data = await fetcher(getSource())
          if (gen === generation) set({ [key]: { data, status: 'ready', error: null } } as Partial<CatalogState>)
        } catch (error) {
          if (gen === generation) {
            set({ [key]: { data: get()[key].data, status: 'error', error: message(error) } } as Partial<CatalogState>)
          }
        }
      })
    }

    function loadKeyed<T>(
      map: 'conceptSetDetails' | 'conceptSetVersions' | 'resolved',
      key: string,
      fetcher: () => Promise<T>,
      cap?: number,
    ): Promise<void> {
      const current = (get()[map] as Record<string, Resource<unknown>>)[key]
      if (current && current.status !== 'error') return inFlight.get(`${map}:${key}`) ?? Promise.resolve()
      const put = (resource: Resource<unknown>) => {
        const next = { ...(get()[map] as Record<string, Resource<unknown>>) }
        delete next[key]
        next[key] = resource
        const keys = Object.keys(next)
        if (cap && keys.length > cap) for (const old of keys.slice(0, keys.length - cap)) delete next[old]
        set({ [map]: next } as Partial<CatalogState>)
      }
      return once(`${map}:${key}`, async () => {
        const gen = generation
        put({ data: null, status: 'loading', error: null })
        try {
          const data = await fetcher()
          if (gen === generation) put({ data, status: 'ready', error: null })
        } catch (error) {
          if (gen === generation) put({ data: null, status: 'error', error: message(error) })
        }
      })
    }

    return {
      ...INITIAL,
      loadConceptSets: (force) => loadList('conceptSets', (s) => s.listConceptSets(), force),
      loadProjects: (force) => loadList('projects', (s) => s.listProjects(), force),
      loadRecommendedUnits: (force) => loadList('recommendedUnits', (s) => s.getRecommendedUnits(), force),
      loadUnitConversions: (force) => loadList('unitConversions', (s) => s.getUnitConversions(), force),
      loadMappingRecommendations: (force) =>
        loadList('mappingRecommendations', (s) => s.getMappingRecommendations(), force),
      loadConceptSet: (id, version) =>
        loadKeyed('conceptSetDetails', conceptSetKey(id, version), () => getSource().getConceptSet(id, version)),
      loadConceptSetVersions: (id) =>
        loadKeyed('conceptSetVersions', String(id), () => getSource().getConceptSetVersions(id)),
      loadResolved: (id, query) =>
        loadKeyed('resolved', resolvedKey(id, query), () => getSource().getResolved(id, query), MAX_RESOLVED_ENTRIES),
      reset: () => {
        generation++
        inFlight.clear()
        set(INITIAL)
      },
    }
  })
}

export const useCatalogStore = createCatalogStore(getDictionarySource)
