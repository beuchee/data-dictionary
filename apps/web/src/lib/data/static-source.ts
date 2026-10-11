import { loadStaticInstanceConfig } from '@/lib/config'
import { conceptSetSummary, pageResolved, versionHistory } from './catalog'
import { repoRawBase, repositoryConfig } from './forge'
import type {
  ConceptSet,
  ConceptSetSummary,
  ConceptSetVersions,
  DictionarySource,
  InstanceInfo,
  MappingRecommendations,
  Project,
  RecommendedUnit,
  ResolvedConceptSet,
  ResolvedPage,
  ResolvedQuery,
  StaticPayload,
  StaticResolvedEntry,
  UnitConversion,
} from './types'

// TODO(v2-cutover): build.py writes the payload to legacy/; the vite plugin serves it as data/.
export const STATIC_PAYLOAD_PATH = 'data/data.json'
export const STATIC_RESOLVED_DIR = 'data/concept_sets_resolved'

/** Where (id, version) of a concept set can be read from in static mode. */
export type VersionLocation =
  | { kind: 'current' }
  | { kind: 'inlined'; conceptSet: ConceptSet }
  | { kind: 'remote'; sha: string }
  | { kind: 'unknown' }

/**
 * The current version is in the payload; a past one a project pins may be
 * inlined (definitions only, never resolved lists); anything else is fetched
 * from the forge at the commit `conceptSetVersionsIndex` records. A version that
 * was never snapshotted is unreachable.
 */
export function locateVersion(
  payload: Pick<StaticPayload, 'conceptSets' | 'conceptSetVersions' | 'conceptSetVersionsIndex'>,
  id: number,
  version: string | undefined,
  what: 'definition' | 'resolved',
): VersionLocation {
  const current = payload.conceptSets.find((cs) => cs.id === id)
  if (!version || current?.version === version) {
    // A resolved file is served even without its definition, as the API does.
    return current || what === 'resolved' ? { kind: 'current' } : { kind: 'unknown' }
  }
  if (what === 'definition') {
    const inlined = payload.conceptSetVersions?.[String(id)]?.[version]
    if (inlined) return { kind: 'inlined', conceptSet: inlined }
  }
  const sha = payload.conceptSetVersionsIndex?.[String(id)]?.[version]
  return sha ? { kind: 'remote', sha } : { kind: 'unknown' }
}

export interface StaticSourceOptions {
  /** The app's base URL (`import.meta.env.BASE_URL`). */
  baseUrl?: string
  fetch?: typeof fetch
}

/** Static mode: the payload `build.py` writes, plus raw files from the forge for past versions. */
export class StaticSource implements DictionarySource {
  readonly mode = 'static' as const
  private readonly baseUrl: string
  private readonly fetchFn: typeof fetch
  private payload: Promise<StaticPayload> | null = null
  private summaries: ConceptSetSummary[] | null = null
  // Promises, so concurrent asks share one request; a failed fetch is kept as null.
  private readonly deferred = new Map<number, Promise<ResolvedConceptSet | null>>()
  private readonly remote = new Map<string, Promise<unknown>>()

  constructor(options: StaticSourceOptions = {}) {
    this.baseUrl = (options.baseUrl ?? import.meta.env.BASE_URL).replace(/\/?$/, '/')
    this.fetchFn = options.fetch ?? ((...args) => fetch(...args))
  }

  async getInstance(): Promise<InstanceInfo> {
    return { config: await loadStaticInstanceConfig(this.baseUrl), server: null }
  }

  private load(): Promise<StaticPayload> {
    if (!this.payload) {
      this.payload = this.fetchJson<StaticPayload>(`${this.baseUrl}${STATIC_PAYLOAD_PATH}`).then((p) => {
        if (!p || !Array.isArray(p.conceptSets)) {
          throw new Error(`${STATIC_PAYLOAD_PATH} is missing or malformed: run \`python3 build.py\``)
        }
        return p
      })
      this.payload.catch(() => {
        this.payload = null
      })
    }
    return this.payload
  }

  private async fetchJson<T>(url: string): Promise<T | null> {
    const res = await this.fetchFn(url)
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
    return (await res.json()) as T
  }

  /** A raw file of the content repo at `sha`, cached; null when unreachable. */
  private fetchRemote<T>(payload: StaticPayload, sha: string, relPath: string): Promise<T | null> {
    const base = repoRawBase(repositoryConfig(payload.config), sha)
    if (!base) return Promise.resolve(null)
    const url = base + relPath
    let pending = this.remote.get(url)
    if (!pending) {
      pending = this.fetchJson<T>(url).catch((error) => {
        console.warn(`Could not fetch ${url}`, error)
        return null
      })
      this.remote.set(url, pending)
    }
    return pending as Promise<T | null>
  }

  private resolvedEntry(payload: StaticPayload, id: number): StaticResolvedEntry | undefined {
    return payload.resolvedConceptSets.find((r) => r.conceptSetId === id)
  }

  private currentResolved(payload: StaticPayload, id: number): Promise<ResolvedConceptSet | null> {
    const entry = this.resolvedEntry(payload, id)
    if (!entry) return Promise.resolve(null)
    if (!entry.resolvedDeferred) return Promise.resolve(entry)
    let pending = this.deferred.get(id)
    if (!pending) {
      pending = this.fetchJson<ResolvedConceptSet>(`${this.baseUrl}${STATIC_RESOLVED_DIR}/${id}.json`)
      pending.catch(() => this.deferred.delete(id))
      this.deferred.set(id, pending)
    }
    return pending
  }

  async listConceptSets(): Promise<ConceptSetSummary[]> {
    const payload = await this.load()
    if (!this.summaries) {
      this.summaries = [...payload.conceptSets]
        .sort((a, b) => a.id - b.id)
        .map((cs) => {
          const entry = this.resolvedEntry(payload, cs.id)
          const count = entry ? (entry.resolvedDeferred ? (entry.resolvedCount ?? 0) : entry.resolvedConcepts.length) : null
          return conceptSetSummary(cs, count)
        })
    }
    return this.summaries
  }

  async getConceptSet(id: number, version?: string): Promise<ConceptSet | null> {
    const payload = await this.load()
    const where = locateVersion(payload, id, version, 'definition')
    if (where.kind === 'current') return payload.conceptSets.find((cs) => cs.id === id) ?? null
    if (where.kind === 'inlined') return where.conceptSet
    if (where.kind === 'remote') return this.fetchRemote<ConceptSet>(payload, where.sha, `concept_sets/${id}.json`)
    return null
  }

  async getResolved(id: number, query: ResolvedQuery = {}): Promise<ResolvedPage | null> {
    const payload = await this.load()
    const where = locateVersion(payload, id, query.version, 'resolved')
    let resolved: ResolvedConceptSet | null = null
    if (where.kind === 'current') resolved = await this.currentResolved(payload, id)
    else if (where.kind === 'remote') {
      resolved = await this.fetchRemote<ResolvedConceptSet>(payload, where.sha, `concept_sets_resolved/${id}.json`)
    }
    if (!resolved) return null
    const current = payload.conceptSets.find((cs) => cs.id === id)
    return pageResolved(resolved, id, query.version ?? current?.version ?? null, query)
  }

  async getConceptSetVersions(id: number): Promise<ConceptSetVersions | null> {
    const payload = await this.load()
    const current = payload.conceptSets.find((cs) => cs.id === id) ?? null
    const indexed = payload.conceptSetVersionsIndex?.[String(id)]
    if (!current && !indexed) return null
    return { id, currentVersion: current?.version ?? null, versions: versionHistory(current, indexed) }
  }

  async listProjects(): Promise<Project[]> {
    return [...(await this.load()).projects].sort((a, b) => a.id - b.id)
  }

  async getProject(id: number): Promise<Project | null> {
    return (await this.load()).projects.find((p) => p.id === id) ?? null
  }

  async getRecommendedUnits(): Promise<RecommendedUnit[]> {
    return (await this.load()).recommendedUnits ?? []
  }

  async getUnitConversions(): Promise<UnitConversion[]> {
    return (await this.load()).unitConversions ?? []
  }

  async getMappingRecommendations(): Promise<MappingRecommendations | null> {
    return (await this.load()).mappingRecommendations ?? null
  }
}
