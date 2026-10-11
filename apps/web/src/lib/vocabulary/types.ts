import type { ExpressionItem, ResolvedConcept, StandardConcept } from '@data-dictionary/format'
import type { ConceptSearchInput } from './sql'

/** One OMOP concept, as `GET /vocabulary/concepts/{id}` returns it. */
export interface OmopConcept {
  conceptId: number
  conceptName: string
  domainId: string
  vocabularyId: string
  conceptClassId: string
  /** 'S' standard, 'C' classification, null non-standard. */
  standardConcept: StandardConcept
  conceptCode: string
  /** `YYYY-MM-DD`. */
  validStartDate: string | null
  validEndDate: string | null
  /** null when valid; 'D' deleted, 'U' upgraded. */
  invalidReason: string | null
}

export interface RelatedConcept extends OmopConcept {
  relationshipId: string
  /** From the RELATIONSHIP table; null when it lacks the row. */
  relationshipName: string | null
}

export interface ConceptSynonym {
  synonymName: string
  languageConceptId: number | null
  languageName: string | null
}

export interface HierarchyNode extends OmopConcept {
  /** 0 the concept itself, -n its ancestors n levels up, +n its descendants. */
  hierarchyLevel: number
}

export interface ConceptHierarchy {
  conceptId: number
  nodes: HierarchyNode[]
  /** Direct parent → child edges among `nodes`. */
  edges: { fromId: number; toId: number }[]
  /** More than `limit` nodes were within `maxDepth`; the nearest were kept. */
  truncated: boolean
}

export interface HierarchyQuery {
  /** Steps up and down, 1–10. Default 5. */
  maxDepth?: number
  /** Nodes kept, nearest first. Default 150. */
  limit?: number
}

export type ConceptSearchQuery = Omit<ConceptSearchInput, 'standard'> & {
  standard?: ('S' | 'C' | 'N')[]
}

export interface ConceptSearchPage {
  /** Matches before paging. */
  total: number
  offset: number
  limit: number
  concepts: OmopConcept[]
}

export interface FilterOptions {
  domains: string[]
  vocabularies: string[]
  conceptClasses: string[]
}

/** An ancestor shared by several concepts (`getAncestorCandidates`). */
export interface AncestorCandidate extends OmopConcept {
  /** How many of the asked concepts it is an ancestor of. */
  coveredCount: number
  /** Steps to the nearest of them. */
  minDepth: number
}

export interface DescendantPair {
  ancestorId: number
  descendantId: number
}

export interface AncestorCandidateQuery {
  /** Steps up, 1–10. Default 5. */
  maxDepth?: number
  /** Candidates kept, best first. Default 30. */
  limit?: number
}

/** `{release, <vocabularyId>: <version>}`, as stamped into resolved files. */
export type VocabularyVersion = Record<string, string | null>

/** The shape of `concept_sets_resolved/{id}.json`. */
export interface ResolveResult {
  conceptSetId: number | null
  vocabularyVersion: VocabularyVersion | null
  resolvedConcepts: ResolvedConcept[]
}

export interface VocabularySummary {
  vocabularyId: string
  vocabularyName: string | null
  vocabularyVersion: string | null
  conceptCount: number
}

/** What any reader may know about the loaded vocabulary. */
export interface VocabularyInfo {
  available: boolean
  /** The ATHENA release (`v5.0 27-FEB-26`), when known. */
  release: string | null
  vocabularies: VocabularySummary[]
}

/**
 * Read access to the OMOP vocabulary, whatever holds it: the API (server mode)
 * or DuckDB-WASM in the browser (static mode). Get it with `getVocabularySource()`.
 * Every method rejects with `VocabularyUnavailableError` when no vocabulary is loaded.
 */
export interface VocabularySource {
  readonly kind: 'api' | 'wasm'
  getInfo(): Promise<VocabularyInfo>
  searchConcepts(query: ConceptSearchQuery): Promise<ConceptSearchPage>
  getFilterOptions(): Promise<FilterOptions>
  /** null when the vocabulary does not hold it. */
  getConcept(conceptId: number): Promise<OmopConcept | null>
  getRelated(conceptId: number): Promise<RelatedConcept[]>
  /** null when the vocabulary does not hold the concept. */
  getHierarchy(conceptId: number, query?: HierarchyQuery): Promise<ConceptHierarchy | null>
  getSynonyms(conceptId: number): Promise<ConceptSynonym[]>
  /** Full rows of the concepts the vocabulary holds among `ids`, by id. */
  getConcepts(ids: readonly number[]): Promise<OmopConcept[]>
  /** Every descendant (never itself) of each of `ancestorIds`, kept to `withinIds` when given. */
  getDescendantPairs(ancestorIds: readonly number[], withinIds?: readonly number[] | null): Promise<DescendantPair[]>
  /** What `ids` map to or from (`Maps to` / `Mapped from`), as the resolver's `includeMapped`. */
  getMappedIds(ids: readonly number[]): Promise<number[]>
  /** Valid ancestors shared by at least two of `ids` (the optimizer's bottom-up step). */
  getAncestorCandidates(ids: readonly number[], query?: AncestorCandidateQuery): Promise<AncestorCandidate[]>
  /** resolve.py's algorithm, live. */
  resolve(items: readonly ExpressionItem[], conceptSetId?: number | null): Promise<ResolveResult>
}

export class VocabularyUnavailableError extends Error {
  constructor(message = 'No OMOP vocabulary is loaded') {
    super(message)
    this.name = 'VocabularyUnavailableError'
  }
}
