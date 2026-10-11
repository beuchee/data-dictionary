import type { ExpressionItem } from '@data-dictionary/format'
import { resolveItems, sqlLookup, stampVersion, versionFromRows } from './resolver'
import { conceptFromRow, nodeFromRow, num, relatedFromRow, synonymFromRow, type Row } from './rows'
import * as sql from './sql'
import { checkReadOnlySql, limitedSql } from './sql-guard'
import {
  SqlQueryError,
  type SqlOptions,
  type SqlResult,
  VocabularyUnavailableError,
  type ConceptHierarchy,
  type ConceptSearchPage,
  type ConceptSearchQuery,
  type ConceptSynonym,
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

  async resolve(items: readonly ExpressionItem[], conceptSetId: number | null = null): Promise<ResolveResult> {
    const run = (q: sql.SqlQuery) => this.run(q)
    const resolvedConcepts = await resolveItems(items, sqlLookup(run, MODE))
    const version = versionFromRows(await run(sql.vocabularyVersions()))
    return { conceptSetId, vocabularyVersion: stampVersion(version, resolvedConcepts), resolvedConcepts }
  }

  // TODO(dev-tools): no time limit in the browser; a runaway query blocks the
  // shared connection until the tab is reloaded.
  async runSql(text: string, options: SqlOptions = {}): Promise<SqlResult> {
    const refusal = checkReadOnlySql(text)
    if (refusal) throw new SqlQueryError(refusal, refusal)
    if (!(await (await library()).ensureMounted())) throw new VocabularyUnavailableError()
    const limit = Math.max(1, Math.min(options.limit ?? 1000, 10_000))
    const start = performance.now()
    let result: { columns: string[]; rows: Row[] }
    try {
      result = await (await engine()).queryTable(limitedSql(text, limit))
    } catch (error) {
      throw new SqlQueryError(error instanceof Error ? error.message : String(error))
    }
    const kept = result.rows.slice(0, limit)
    return {
      columns: result.columns,
      rows: kept.map((r) => result.columns.map((c) => cellValue(r[c]))),
      rowCount: kept.length,
      truncated: result.rows.length > limit,
      elapsedMs: Math.round(performance.now() - start),
    }
  }
}

/** Arrow values the results table and the CSV can show: dates as ISO text, nested values as JSON. */
function cellValue(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? Number(v) : v))
    } catch {
      return String(value)
    }
  }
  return value
}
