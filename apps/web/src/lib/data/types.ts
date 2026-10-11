import type {
  ConceptSet,
  ConceptSetVersionsIndex,
  MappingRecommendations,
  OrganizationRef,
  Project,
  RecommendedUnit,
  ResolvedConcept,
  ResolvedConceptSet,
  ReviewStatus,
  UnitConversion,
} from '@data-dictionary/format'
import type { InstanceConfig } from '@/lib/config'

export type {
  ConceptSet,
  MappingRecommendations,
  Project,
  RecommendedUnit,
  ResolvedConcept,
  ResolvedConceptSet,
  UnitConversion,
}

export interface ConceptSetSummaryTranslation {
  name?: string | null
  category?: string | null
  subcategory?: string | null
  shortDescription?: string | null
}

/** One row of the concept set list: `GET /concept-sets`, or derived from the static payload. */
export interface ConceptSetSummary {
  id: number
  version: string
  uniqueId: string | null
  /** Only the languages the file has: no cross-language fallback. */
  translations: Record<string, ConceptSetSummaryTranslation>
  reviewStatus: ReviewStatus | null
  /** Legacy flat organizations are read as both `created` and `current`. */
  organization: { created: OrganizationRef | null; current: OrganizationRef | null } | null
  itemCount: number
  /** null when the set has no resolved list. */
  resolvedCount: number | null
  modifiedDate: string | null
  modifiedBy: string | null
}

export interface ResolvedQuery {
  /** A past version; omitted = the current one. */
  version?: string
  /** Case-insensitive match on id, name, code and vocabulary. */
  search?: string
  offset?: number
  /** Omitted = everything after `offset`. */
  limit?: number
}

/** `GET /concept-sets/{id}/resolved`; `total` counts the filtered list before paging. */
export interface ResolvedPage {
  conceptSetId: number
  version: string | null
  vocabularyVersion: ResolvedConceptSet['vocabularyVersion']
  total: number
  offset: number
  limit: number | null
  resolvedConcepts: ResolvedConcept[]
}

export interface VersionInfo {
  version: string
  /** Commit that introduced it; null when never snapshotted (then unreachable). */
  commit: string | null
  isCurrent: boolean
  date: string | null
  author: string | null
  message: string | null
}

export interface ConceptSetVersions {
  id: number
  currentVersion: string | null
  /** Newest first. */
  versions: VersionInfo[]
}

/** What the server offers (`GET /instance/config` → `server`); null in static mode. */
export interface ServerCapabilities {
  appVersion: string
  authProviders: string[]
  anonymousRead: boolean
  versionHistory: boolean
  passwordMinLength: number
}

export interface InstanceInfo {
  config: InstanceConfig
  server: ServerCapabilities | null
}

/**
 * Read access to the dictionary content, whatever the deployment: the API in
 * server mode, the static payload built by `build.py` otherwise. Both return the
 * same shapes. "Not found" is `null`; transport failures reject.
 */
export interface DictionarySource {
  readonly mode: 'server' | 'static'
  getInstance(): Promise<InstanceInfo>
  listConceptSets(): Promise<ConceptSetSummary[]>
  getConceptSet(id: number, version?: string): Promise<ConceptSet | null>
  getResolved(id: number, query?: ResolvedQuery): Promise<ResolvedPage | null>
  getConceptSetVersions(id: number): Promise<ConceptSetVersions | null>
  listProjects(): Promise<Project[]>
  getProject(id: number): Promise<Project | null>
  getRecommendedUnits(): Promise<RecommendedUnit[]>
  getUnitConversions(): Promise<UnitConversion[]>
  getMappingRecommendations(): Promise<MappingRecommendations | null>
  /**
   * The repository's next free ids (`id_counters.json`), which also cover deleted
   * files; null when unknown. Only the static source has them: in server mode the
   * server allocates ids at submit.
   */
  getNextIds?(): Promise<{ conceptSet: number | null; project: number | null }>
}

/** A resolved entry of the static payload: big lists are deferred to their own file. */
export type StaticResolvedEntry = ResolvedConceptSet & { resolvedDeferred?: boolean; resolvedCount?: number }

/** `legacy/data.json` as written by build.py (served as `data/data.json`). */
export interface StaticPayload {
  dataVersion?: string
  dataHash?: string
  config: InstanceConfig
  conceptSets: ConceptSet[]
  projects: Project[]
  resolvedConceptSets: StaticResolvedEntry[]
  /** Past versions a project pins, inlined when small: `{id: {version: conceptSet}}`. */
  conceptSetVersions?: Record<string, Record<string, ConceptSet>>
  conceptSetVersionsIndex?: ConceptSetVersionsIndex
  unitConversions?: UnitConversion[]
  recommendedUnits?: RecommendedUnit[]
  mappingRecommendations?: MappingRecommendations | null
  nextConceptSetId?: number
  nextProjectId?: number
}
