import type { ExpressionItem } from '@data-dictionary/format'
import { resolveItems, sqlLookup, stampVersion, versionFromRows } from './resolver'
import { candidateFromRow, conceptFromRow, nodeFromRow, num, relatedFromRow, synonymFromRow, type Row } from './rows'
import * as sql from './sql'
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

// The browser keeps only the direct concept_ancestor rows (see wasm/athena-files.ts).
const MODE: sql.HierarchyMode = 'edges'

/** The engine and loader are imported on first use: DuckDB-WASM stays out of the main bundle. */
const library = () => import('./wasm/library')
const engine = () => import('./wasm/engine')

/**
 * Static mode: the vocabulary the user loaded into DuckDB-WASM (Settings →
 * Vocabularies), running the same SQL builders as the server.
 */
export class WasmVocabularySource implements VocabularySource {
  readonly kind = 'wasm' as const
  private filterOptions: Promise<FilterOptions> | null = null

  constructor() {
    void library().then((m) => m.onVocabularyChange(() => (this.filterOptions = null)))
  }

  private async run(query: sql.SqlQuery): Promise<Row[]> {
    if (!(await (await library()).ensureMounted())) throw new VocabularyUnavailableError()
    return (await engine()).query(query.sql, query.params)
  }

  async getInfo(): Promise<VocabularyInfo> {
    if (!(await (await library()).ensureMounted())) return { available: false, release: null, vocabularies: [] }
    const { query } = await engine()
    const versions = versionFromRows(await query(sql.vocabularyVersions().sql))
    const counts = await query('SELECT vocabulary_id, COUNT(*) AS n FROM concept GROUP BY vocabulary_id ORDER BY vocabulary_id')
    const names = new Map(
      (await query('SELECT vocabulary_id, vocabulary_name FROM vocabulary')).map((r) => [String(r.vocabulary_id), r.vocabulary_name]),
    )
    return {
      available: true,
      release: versions?.release ?? null,
      vocabularies: counts.map((r) => {
        const id = String(r.vocabulary_id)
        return {
          vocabularyId: id,
          vocabularyName: (names.get(id) as string | undefined) ?? null,
          vocabularyVersion: id === 'None' ? (versions?.release ?? null) : (versions?.[id] ?? null),
          conceptCount: num(r.n),
        }
      }),
    }
  }

  async searchConcepts(query: ConceptSearchQuery): Promise<ConceptSearchPage> {
    const { page, count } = sql.conceptSearch(query)
    const [rows, totals] = await Promise.all([this.run(page), this.run(count)])
    return {
      total: num(totals[0]?.total ?? 0),
      offset: query.offset ?? 0,
      limit: query.limit ?? 50,
      concepts: rows.map(conceptFromRow),
    }
  }

  getFilterOptions(): Promise<FilterOptions> {
    this.filterOptions ??= (async () => {
      const values = async (column: sql.FilterOptionColumn) => (await this.run(sql.filterOptions(column))).map((r) => String(r.value))
      return {
        domains: await values('domain_id'),
        vocabularies: await values('vocabulary_id'),
        conceptClasses: await values('concept_class_id'),
      }
    })().catch((error) => {
      this.filterOptions = null
      throw error
    })
    return this.filterOptions
  }

  async getConcept(conceptId: number): Promise<OmopConcept | null> {
    const rows = await this.run(sql.conceptById(conceptId))
    return rows[0] ? conceptFromRow(rows[0]) : null
  }

  async getRelated(conceptId: number): Promise<RelatedConcept[]> {
    return (await this.run(sql.relatedConcepts(conceptId))).map(relatedFromRow)
  }

  async getHierarchy(conceptId: number, query: HierarchyQuery = {}): Promise<ConceptHierarchy | null> {
    const limit = query.limit ?? 150
    const rows = await this.run(sql.hierarchyNodes(conceptId, MODE, query.maxDepth ?? 5, limit + 1))
    if (!rows.some((r) => num(r.concept_id) === conceptId)) return null
    const nodes = rows.slice(0, limit).map(nodeFromRow)
    const edges = (await this.run(sql.hierarchyEdges(nodes.map((n) => n.conceptId)))).map((e) => ({
      fromId: num(e.from_id),
      toId: num(e.to_id),
    }))
    return { conceptId, nodes, edges, truncated: rows.length > limit }
  }

  async getSynonyms(conceptId: number): Promise<ConceptSynonym[]> {
    return (await this.run(sql.synonyms(conceptId))).map(synonymFromRow)
  }

  async getConcepts(ids: readonly number[]): Promise<OmopConcept[]> {
    if (!ids.length) return []
    return (await this.run(sql.conceptsByIds(ids))).map(conceptFromRow)
  }

  async getDescendantPairs(ancestorIds: readonly number[], withinIds: readonly number[] | null = null): Promise<DescendantPair[]> {
    if (!ancestorIds.length || (withinIds && !withinIds.length)) return []
    return (await this.run(sql.descendantPairs(ancestorIds, MODE, withinIds))).map((r) => ({
      ancestorId: num(r.ancestor_id),
      descendantId: num(r.descendant_id),
    }))
  }

  async getMappedIds(ids: readonly number[]): Promise<number[]> {
    if (!ids.length) return []
    return (await this.run(sql.mappedIds(ids))).map((r) => num(r.concept_id))
  }

  async getAncestorCandidates(ids: readonly number[], query: AncestorCandidateQuery = {}): Promise<AncestorCandidate[]> {
    if (!ids.length) return []
    return (await this.run(sql.ancestorCandidates(ids, MODE, query.maxDepth ?? 5, query.limit ?? 30))).map(candidateFromRow)
  }

  async resolve(items: readonly ExpressionItem[], conceptSetId: number | null = null): Promise<ResolveResult> {
    const run = (q: sql.SqlQuery) => this.run(q)
    const resolvedConcepts = await resolveItems(items, sqlLookup(run, MODE))
    const version = versionFromRows(await run(sql.vocabularyVersions()))
    return { conceptSetId, vocabularyVersion: stampVersion(version, resolvedConcepts), resolvedConcepts }
  }
}
