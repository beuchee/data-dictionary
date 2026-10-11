import type { ExpressionItem } from '@data-dictionary/format'
import { ApiError, apiRequest } from '@/lib/api-client'
import {
  VocabularyUnavailableError,
  type AncestorCandidate,
  type AncestorCandidateQuery,
  type ConceptHierarchy,
  type ConceptSearchPage,
  type ConceptSearchQuery,
  type ConceptSynonym,
  type DescendantPair,
  type FilterOptions,
  type HierarchyQuery,
  type OmopConcept,
  type RelatedConcept,
  type ResolveResult,
  type VocabularyInfo,
  type VocabularySource,
} from './types'

/** Query string of `GET /vocabulary/concepts/search` (repeated keys for lists, empty values left out). */
export function searchQueryString(query: ConceptSearchQuery): string {
  const params = new URLSearchParams()
  if (query.term?.trim()) params.set('q', query.term.trim())
  for (const v of query.domainIds ?? []) params.append('domain', v)
  for (const v of query.vocabularyIds ?? []) params.append('vocabulary', v)
  for (const v of query.conceptClassIds ?? []) params.append('conceptClass', v)
  for (const v of query.standard ?? []) params.append('standard', v)
  if (query.validOnly) params.set('validOnly', 'true')
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.offset) params.set('offset', String(query.offset))
  const s = params.toString()
  return s ? `?${s}` : ''
}

/** 503 = no vocabulary imported on the server. */
async function call<T>(request: Promise<T>): Promise<T> {
  try {
    return await request
  } catch (error) {
    if (error instanceof ApiError && error.status === 503) throw new VocabularyUnavailableError()
    throw error
  }
}

async function orNull<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await call(request)
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

const V = '/vocabulary'

/** Server mode: `/api/v1/vocabulary/*` (apps/api/app/api/v1/routes/vocabulary.py). */
export class ApiVocabularySource implements VocabularySource {
  readonly kind = 'api' as const

  getInfo(): Promise<VocabularyInfo> {
    return apiRequest(`${V}/info`)
  }

  searchConcepts(query: ConceptSearchQuery): Promise<ConceptSearchPage> {
    return call(apiRequest(`${V}/concepts/search${searchQueryString(query)}`))
  }

  getFilterOptions(): Promise<FilterOptions> {
    return call(apiRequest(`${V}/filter-options`))
  }

  getConcept(conceptId: number): Promise<OmopConcept | null> {
    return orNull(apiRequest(`${V}/concepts/${conceptId}`))
  }

  getRelated(conceptId: number): Promise<RelatedConcept[]> {
    return call(apiRequest(`${V}/concepts/${conceptId}/related`))
  }

  getHierarchy(conceptId: number, query: HierarchyQuery = {}): Promise<ConceptHierarchy | null> {
    const params = new URLSearchParams()
    if (query.maxDepth !== undefined) params.set('maxDepth', String(query.maxDepth))
    if (query.limit !== undefined) params.set('limit', String(query.limit))
    const qs = params.toString()
    return orNull(apiRequest(`${V}/concepts/${conceptId}/hierarchy${qs ? `?${qs}` : ''}`))
  }

  getSynonyms(conceptId: number): Promise<ConceptSynonym[]> {
    return call(apiRequest(`${V}/concepts/${conceptId}/synonyms`))
  }

  async getConcepts(ids: readonly number[]): Promise<OmopConcept[]> {
    if (!ids.length) return []
    return call(apiRequest(`${V}/concepts/batch`, { method: 'POST', body: JSON.stringify({ ids }) }))
  }

  async getDescendantPairs(ancestorIds: readonly number[], withinIds: readonly number[] | null = null): Promise<DescendantPair[]> {
    if (!ancestorIds.length || (withinIds && !withinIds.length)) return []
    return call(apiRequest(`${V}/descendant-pairs`, { method: 'POST', body: JSON.stringify({ ancestorIds, withinIds }) }))
  }

  async getMappedIds(ids: readonly number[]): Promise<number[]> {
    if (!ids.length) return []
    return call(apiRequest(`${V}/mapped-ids`, { method: 'POST', body: JSON.stringify({ ids }) }))
  }

  async getAncestorCandidates(ids: readonly number[], query: AncestorCandidateQuery = {}): Promise<AncestorCandidate[]> {
    if (!ids.length) return []
    return call(
      apiRequest(`${V}/ancestor-candidates`, {
        method: 'POST',
        body: JSON.stringify({ ids, maxDepth: query.maxDepth ?? 5, limit: query.limit ?? 30 }),
      }),
    )
  }

  resolve(items: readonly ExpressionItem[], conceptSetId: number | null = null): Promise<ResolveResult> {
    return call(
      apiRequest(`${V}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ conceptSetId, expression: { items } }),
      }),
    )
  }
}
