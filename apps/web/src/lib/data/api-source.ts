import { normalizeInstanceConfig, type InstanceConfig } from '@/lib/config'
import { ApiError, apiRequest } from '@/lib/api-client'
import type {
  ConceptSet,
  ConceptSetSummary,
  ConceptSetVersions,
  CustomConceptUse,
  DictionarySource,
  InstanceInfo,
  MappingRecommendations,
  Project,
  RecommendedUnit,
  ResolvedPage,
  ResolvedQuery,
  ServerCapabilities,
  UnitConversion,
} from './types'

/** Query string of `GET /concept-sets/{id}/resolved` (empty values left out). */
export function resolvedQueryString(query: ResolvedQuery = {}): string {
  const params = new URLSearchParams()
  if (query.version) params.set('version', query.version)
  if (query.search?.trim()) params.set('search', query.search.trim())
  if (query.offset) params.set('offset', String(query.offset))
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  const s = params.toString()
  return s ? `?${s}` : ''
}

function versionQuery(version: string | undefined): string {
  return version ? `?${new URLSearchParams({ version })}` : ''
}

async function orNull<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

/** Server mode: the read routes of apps/api (`/api/v1/...`). */
export class ApiSource implements DictionarySource {
  readonly mode = 'server' as const

  async getInstance(): Promise<InstanceInfo> {
    const body = await apiRequest<{ config: Partial<InstanceConfig>; server: ServerCapabilities }>('/instance/config')
    return { config: normalizeInstanceConfig(body.config), server: body.server }
  }

  listConceptSets(): Promise<ConceptSetSummary[]> {
    return apiRequest('/concept-sets')
  }

  listCustomConcepts(): Promise<CustomConceptUse[]> {
    return apiRequest('/concept-sets/custom-concepts')
  }

  getConceptSet(id: number, version?: string): Promise<ConceptSet | null> {
    return orNull(apiRequest(`/concept-sets/${id}${versionQuery(version)}`))
  }

  getResolved(id: number, query?: ResolvedQuery): Promise<ResolvedPage | null> {
    return orNull(apiRequest(`/concept-sets/${id}/resolved${resolvedQueryString(query)}`))
  }

  getConceptSetVersions(id: number): Promise<ConceptSetVersions | null> {
    return orNull(apiRequest(`/concept-sets/${id}/versions`))
  }

  listProjects(): Promise<Project[]> {
    return apiRequest('/projects')
  }

  getProject(id: number): Promise<Project | null> {
    return orNull(apiRequest(`/projects/${id}`))
  }

  getRecommendedUnits(): Promise<RecommendedUnit[]> {
    return apiRequest('/units/recommended')
  }

  getUnitConversions(): Promise<UnitConversion[]> {
    return apiRequest('/units/conversions')
  }

  getMappingRecommendations(): Promise<MappingRecommendations | null> {
    return apiRequest('/mapping-recommendations')
  }
}
