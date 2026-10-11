/**
 * SQL builders over the OMOP vocabulary tables. Twin of
 * `apps/api/app/services/vocabulary_queries.py`: both produce the **same text**
 * for the same input, checked against `apps/api/tests/fixtures/vocab/sql-golden.json`
 * by both test suites (the Python suite also runs every golden query on the
 * fixture vocabulary, on both `concept_ancestor` layouts).
 *
 * Safety: user text only ever travels as a `$n` parameter. Concept ids are
 * inlined, but only after `conceptId` has checked they are safe non-negative
 * integers; limits and depths are clamped integers; every other literal is a
 * constant.
 *
 * `mode` says what `concept_ancestor` holds: `closure` is the full ATHENA table
 * (the server), `edges` only its direct parent-child rows (the browser, which
 * cannot hold the 80 M-row closure), walked with a recursive CTE.
 */

export interface SqlQuery {
  sql: string
  params: (string | number)[]
}

export type HierarchyMode = 'closure' | 'edges'

export const JW_FUZZY_THRESHOLD = '0.75'
export const SEARCH_MAX_LIMIT = 1000
export const RELATED_LIMIT = 10_000
export const HIERARCHY_MAX_DEPTH = 10
export const HIERARCHY_MAX_NODES = 2000
export const STANDARD_FILTERS = ['S', 'C', 'N'] as const
export type StandardFilter = (typeof STANDARD_FILTERS)[number]
export const FILTER_OPTION_COLUMNS = ['domain_id', 'vocabulary_id', 'concept_class_id'] as const
export type FilterOptionColumn = (typeof FILTER_OPTION_COLUMNS)[number]

export const CONCEPT_COLUMNS =
  'c.concept_id, c.concept_name, c.domain_id, c.vocabulary_id, c.concept_class_id, c.standard_concept, ' +
  'c.concept_code, CAST(c.valid_start_date AS VARCHAR) AS valid_start_date, ' +
  'CAST(c.valid_end_date AS VARCHAR) AS valid_end_date, c.invalid_reason'

/** An input no query may be built from (a non-integer id, an unknown filter). */
export class QueryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QueryError'
  }
}

/** A concept id we are willing to inline: a safe, non-negative integer. */
export function conceptId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new QueryError(`Invalid concept id: ${String(value)}`)
  }
  return value
}

function idList(ids: Iterable<unknown>): string {
  const unique = [...new Set([...ids].map(conceptId))].sort((a, b) => a - b)
  if (!unique.length) throw new QueryError('No concept ids')
  return unique.join(', ')
}

function clamp(value: unknown, low: number, high: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new QueryError(`Invalid integer: ${String(value)}`)
  }
  return Math.max(low, Math.min(high, value))
}

class Params {
  values: (string | number)[] = []
  add(value: string | number): string {
    this.values.push(value)
    return `$${this.values.length}`
  }
}

const fold = (expr: string) => `strip_accents(lower(${expr}))`

function inParams(column: string, values: readonly string[], params: Params): string {
  return `${column} IN (${values.map((v) => params.add(v)).join(', ')})`
}

// --- Concept search -----------------------------------------------------------

export interface ConceptSearchInput {
  term?: string
  domainIds?: readonly string[]
  vocabularyIds?: readonly string[]
  conceptClassIds?: readonly string[]
  /** 'S' standard, 'C' classification, 'N' non-standard; OR-ed. */
  standard?: readonly string[]
  validOnly?: boolean
  limit?: number
  offset?: number
}

/**
 * The page and count queries of a concept search. Ranking (Linkr's fuzzy
 * search, lower = better): 0 exact id (numeric term), 1 exact code, 2 exact
 * name, 3 name prefix, 4 every word in the name or code, 5 whole-string
 * Jaro-Winkler >= 0.75 on name or code; within a tier, higher similarity first,
 * then concept_id. Accent- and case-folded on both sides.
 */
export function conceptSearch(input: ConceptSearchInput = {}): { page: SqlQuery; count: SqlQuery } {
  const params = new Params()
  const where: string[] = []
  let order = 'c.concept_id'
  const q = (input.term ?? '').trim()
  if (q) {
    const name = fold('c.concept_name')
    const code = fold("COALESCE(c.concept_code, '')")
    const folded = fold(params.add(q))
    const tiers: [number, string][] = []
    if (/^[0-9]+$/.test(q) && q.length <= 15) tiers.push([0, `c.concept_id = ${Number(q)}`])
    tiers.push([1, `${code} = ${folded}`])
    tiers.push([2, `${name} = ${folded}`])
    tiers.push([3, `starts_with(${name}, ${folded})`])
    const words = q
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => {
        const p = fold(params.add(w))
        return `(contains(${name}, ${p}) OR contains(${code}, ${p}))`
      })
    tiers.push([4, words.join(' AND ')])
    const nameSim = `jaro_winkler_similarity(${name}, ${folded})`
    const codeSim = `jaro_winkler_similarity(${code}, ${folded})`
    tiers.push([5, `(${nameSim} >= ${JW_FUZZY_THRESHOLD} OR ${codeSim} >= ${JW_FUZZY_THRESHOLD})`])
    where.push(`(${tiers.map(([, clause]) => `(${clause})`).join(' OR ')})`)
    const whens = tiers
      .slice(0, -1)
      .map(([tier, clause]) => `WHEN ${clause} THEN ${tier}`)
      .join(' ')
    order = `(CASE ${whens} ELSE 5 END + (1.0 - GREATEST(${nameSim}, ${codeSim}))), c.concept_id`
  }
  const filters: [string, readonly string[] | undefined][] = [
    ['c.domain_id', input.domainIds],
    ['c.vocabulary_id', input.vocabularyIds],
    ['c.concept_class_id', input.conceptClassIds],
  ]
  for (const [column, values] of filters) {
    if (values?.length) where.push(inParams(column, values, params))
  }
  const standard = input.standard ?? []
  if (standard.length) {
    const unknown = standard.filter((s) => !(STANDARD_FILTERS as readonly string[]).includes(s))
    if (unknown.length) throw new QueryError(`Unknown standard filter: ${unknown.join(', ')}`)
    const conds: string[] = []
    if (standard.includes('S')) conds.push("c.standard_concept = 'S'")
    if (standard.includes('C')) conds.push("c.standard_concept = 'C'")
    if (standard.includes('N')) conds.push("(c.standard_concept IS NULL OR c.standard_concept NOT IN ('S', 'C'))")
    where.push(`(${conds.join(' OR ')})`)
  }
  if (input.validOnly) where.push("(c.invalid_reason IS NULL OR c.invalid_reason = '')")
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : ''
  const limit = clamp(input.limit ?? 50, 1, SEARCH_MAX_LIMIT)
  const offset = clamp(input.offset ?? 0, 0, 2 ** 31 - 1)
  return {
    page: {
      sql: `SELECT ${CONCEPT_COLUMNS} FROM concept c${whereSql} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`,
      params: [...params.values],
    },
    count: { sql: `SELECT COUNT(*) AS total FROM concept c${whereSql}`, params: [...params.values] },
  }
}

// --- One concept ------------------------------------------------------------------

export function conceptById(id: unknown): SqlQuery {
  return { sql: `SELECT ${CONCEPT_COLUMNS} FROM concept c WHERE c.concept_id = ${conceptId(id)}`, params: [] }
}

/** Valid relationships from the concept, with the relationship's name. */
export function relatedConcepts(id: unknown): SqlQuery {
  const i = conceptId(id)
  return {
    sql:
      'SELECT cr.relationship_id, r.relationship_name, ' +
      `${CONCEPT_COLUMNS} FROM concept_relationship cr ` +
      'JOIN concept c ON c.concept_id = cr.concept_id_2 ' +
      'LEFT JOIN relationship r ON r.relationship_id = cr.relationship_id ' +
      `WHERE cr.concept_id_1 = ${i} AND (cr.invalid_reason IS NULL OR cr.invalid_reason = '') ` +
      `ORDER BY cr.relationship_id, c.concept_name, c.concept_id LIMIT ${RELATED_LIMIT}`,
    params: [],
  }
}

export function synonyms(id: unknown): SqlQuery {
  return {
    sql:
      'SELECT cs.concept_synonym_name, cs.language_concept_id, l.concept_name AS language_name ' +
      'FROM concept_synonym cs LEFT JOIN concept l ON l.concept_id = cs.language_concept_id ' +
      `WHERE cs.concept_id = ${conceptId(id)} ` +
      'ORDER BY l.concept_name NULLS LAST, cs.concept_synonym_name',
    params: [],
  }
}

// --- Hierarchy ----------------------------------------------------------------------

/**
 * The concept (level 0), its ancestors (negative levels) and descendants
 * (positive levels) up to `maxDepth` steps, nearest first, at most `limit` rows
 * (ask for one more than you show to know it was cut).
 */
export function hierarchyNodes(id: unknown, mode: HierarchyMode, maxDepth: unknown = 5, limit: unknown = 150): SqlQuery {
  const i = conceptId(id)
  const depth = clamp(maxDepth, 1, HIERARCHY_MAX_DEPTH)
  let prefix = ''
  let levels: string
  if (mode === 'closure') {
    levels =
      'SELECT ca.ancestor_concept_id AS concept_id, -MIN(ca.min_levels_of_separation) AS level ' +
      `FROM concept_ancestor ca WHERE ca.descendant_concept_id = ${i} AND ca.ancestor_concept_id <> ${i} ` +
      `AND ca.min_levels_of_separation <= ${depth} GROUP BY ca.ancestor_concept_id ` +
      'UNION ALL ' +
      'SELECT ca.descendant_concept_id AS concept_id, MIN(ca.min_levels_of_separation) AS level ' +
      `FROM concept_ancestor ca WHERE ca.ancestor_concept_id = ${i} AND ca.descendant_concept_id <> ${i} ` +
      `AND ca.min_levels_of_separation <= ${depth} GROUP BY ca.descendant_concept_id ` +
      `UNION ALL SELECT ${i} AS concept_id, 0 AS level`
  } else if (mode === 'edges') {
    // UNION (not UNION ALL) on (id, depth): a multi-parent DAG would otherwise
    // enumerate every path.
    prefix =
      'WITH RECURSIVE up(concept_id, depth) AS (' +
      'SELECT ca.ancestor_concept_id, 1 FROM concept_ancestor ca ' +
      `WHERE ca.min_levels_of_separation = 1 AND ca.descendant_concept_id = ${i} ` +
      'UNION SELECT ca.ancestor_concept_id, up.depth + 1 FROM concept_ancestor ca ' +
      'JOIN up ON ca.descendant_concept_id = up.concept_id ' +
      `WHERE ca.min_levels_of_separation = 1 AND up.depth < ${depth}), ` +
      'down(concept_id, depth) AS (' +
      'SELECT ca.descendant_concept_id, 1 FROM concept_ancestor ca ' +
      `WHERE ca.min_levels_of_separation = 1 AND ca.ancestor_concept_id = ${i} ` +
      'UNION SELECT ca.descendant_concept_id, down.depth + 1 FROM concept_ancestor ca ' +
      'JOIN down ON ca.ancestor_concept_id = down.concept_id ' +
      `WHERE ca.min_levels_of_separation = 1 AND down.depth < ${depth}) `
    levels =
      `SELECT concept_id, -MIN(depth) AS level FROM up WHERE concept_id <> ${i} GROUP BY concept_id ` +
      `UNION ALL SELECT concept_id, MIN(depth) AS level FROM down WHERE concept_id <> ${i} GROUP BY concept_id ` +
      `UNION ALL SELECT ${i} AS concept_id, 0 AS level`
  } else {
    throw new QueryError(`Unknown hierarchy mode: ${String(mode)}`)
  }
  return {
    sql:
      `${prefix}SELECT ${CONCEPT_COLUMNS}, h.level AS hierarchy_level FROM (${levels}) h ` +
      'JOIN concept c ON c.concept_id = h.concept_id ' +
      `ORDER BY abs(h.level), h.level, c.concept_id LIMIT ${clamp(limit, 1, HIERARCHY_MAX_NODES + 1)}`,
    params: [],
  }
}

/** Direct parent → child edges among `ids` (for the graph). */
export function hierarchyEdges(ids: Iterable<unknown>): SqlQuery {
  const list = idList(ids)
  return {
    sql:
      'SELECT DISTINCT ca.ancestor_concept_id AS from_id, ca.descendant_concept_id AS to_id ' +
      'FROM concept_ancestor ca WHERE ca.min_levels_of_separation = 1 ' +
      `AND ca.ancestor_concept_id IN (${list}) AND ca.descendant_concept_id IN (${list}) ` +
      'ORDER BY from_id, to_id',
    params: [],
  }
}

// --- Resolution (see resolver.ts) ----------------------------------------------------

export function descendantIds(ids: Iterable<unknown>, mode: HierarchyMode): SqlQuery {
  const list = idList(ids)
  if (mode === 'closure') {
    return {
      sql:
        'SELECT DISTINCT ca.descendant_concept_id AS concept_id FROM concept_ancestor ca ' +
        `WHERE ca.ancestor_concept_id IN (${list}) AND ca.descendant_concept_id <> ca.ancestor_concept_id`,
      params: [],
    }
  }
  if (mode === 'edges') {
    return {
      sql:
        'WITH RECURSIVE d(concept_id) AS (' +
        'SELECT ca.descendant_concept_id FROM concept_ancestor ca ' +
        `WHERE ca.min_levels_of_separation = 1 AND ca.ancestor_concept_id IN (${list}) ` +
        'UNION SELECT ca.descendant_concept_id FROM concept_ancestor ca ' +
        'JOIN d ON ca.ancestor_concept_id = d.concept_id WHERE ca.min_levels_of_separation = 1) ' +
        'SELECT DISTINCT concept_id FROM d',
      params: [],
    }
  }
  throw new QueryError(`Unknown hierarchy mode: ${String(mode)}`)
}

/** Both directions, as resolve.py: a standard concept's `Mapped from` rows bring its source codes in. */
export function mappedIds(ids: Iterable<unknown>): SqlQuery {
  return {
    sql:
      'SELECT DISTINCT cr.concept_id_2 AS concept_id FROM concept_relationship cr ' +
      `WHERE cr.concept_id_1 IN (${idList(ids)}) AND cr.relationship_id IN ('Maps to', 'Mapped from')`,
    params: [],
  }
}

export function resolvedDetails(ids: Iterable<unknown>): SqlQuery {
  return {
    sql:
      'SELECT c.concept_id, c.concept_name, c.vocabulary_id, c.domain_id, c.concept_class_id, c.concept_code, ' +
      `c.standard_concept FROM concept c WHERE c.concept_id IN (${idList(ids)})`,
    params: [],
  }
}

// --- Expression optimization (features/concept-sets/lib/optimize.ts) -----------------

export const ANCESTOR_CANDIDATE_MAX_DEPTH = 10
export const ANCESTOR_CANDIDATE_MAX_LIMIT = 200

/** Full rows of the given concepts, by id. */
export function conceptsByIds(ids: Iterable<unknown>): SqlQuery {
  return { sql: `SELECT ${CONCEPT_COLUMNS} FROM concept c WHERE c.concept_id IN (${idList(ids)}) ORDER BY c.concept_id`, params: [] }
}

/**
 * (ancestor, descendant) pairs: every descendant of each of `ancestorIds`
 * (never itself), kept to `withinIds` when given.
 */
export function descendantPairs(ancestorIds: Iterable<unknown>, mode: HierarchyMode, withinIds: Iterable<unknown> | null = null): SqlQuery {
  const list = idList(ancestorIds)
  const within = withinIds === null ? null : idList(withinIds)
  if (mode === 'closure') {
    return {
      sql:
        'SELECT DISTINCT ca.ancestor_concept_id AS ancestor_id, ca.descendant_concept_id AS descendant_id ' +
        `FROM concept_ancestor ca WHERE ca.ancestor_concept_id IN (${list}) ` +
        'AND ca.descendant_concept_id <> ca.ancestor_concept_id' +
        (within ? ` AND ca.descendant_concept_id IN (${within})` : '') +
        ' ORDER BY ancestor_id, descendant_id',
      params: [],
    }
  }
  if (mode === 'edges') {
    // UNION carries the root ancestor down; it dedupes, so a multi-parent DAG terminates.
    return {
      sql:
        'WITH RECURSIVE d(ancestor_id, descendant_id) AS (' +
        'SELECT ca.ancestor_concept_id, ca.descendant_concept_id FROM concept_ancestor ca ' +
        `WHERE ca.min_levels_of_separation = 1 AND ca.ancestor_concept_id IN (${list}) ` +
        'UNION SELECT d.ancestor_id, ca.descendant_concept_id FROM concept_ancestor ca ' +
        'JOIN d ON ca.ancestor_concept_id = d.descendant_id WHERE ca.min_levels_of_separation = 1) ' +
        'SELECT DISTINCT ancestor_id, descendant_id FROM d WHERE descendant_id <> ancestor_id' +
        (within ? ` AND descendant_id IN (${within})` : '') +
        ' ORDER BY ancestor_id, descendant_id',
      params: [],
    }
  }
  throw new QueryError(`Unknown hierarchy mode: ${String(mode)}`)
}

/**
 * Valid ancestors (up to `maxDepth` steps) shared by at least two of `ids`,
 * themselves outside `ids`: how many of `ids` each covers and how close it
 * is, most covering first, then nearest, then by id (v1's bottom-up optimizer).
 */
export function ancestorCandidates(ids: Iterable<unknown>, mode: HierarchyMode, maxDepth: unknown = 5, limit: unknown = 30): SqlQuery {
  const list = idList(ids)
  const depth = clamp(maxDepth, 1, ANCESTOR_CANDIDATE_MAX_DEPTH)
  const n = clamp(limit, 1, ANCESTOR_CANDIDATE_MAX_LIMIT)
  let prefix = ''
  let source: string
  if (mode === 'closure') {
    source =
      '(SELECT ca.ancestor_concept_id AS ancestor_id, ca.descendant_concept_id AS descendant_id, ' +
      'ca.min_levels_of_separation AS depth FROM concept_ancestor ca ' +
      `WHERE ca.descendant_concept_id IN (${list}) AND ca.min_levels_of_separation BETWEEN 1 AND ${depth}) a`
  } else if (mode === 'edges') {
    prefix =
      'WITH RECURSIVE anc(ancestor_id, descendant_id, depth) AS (' +
      'SELECT ca.ancestor_concept_id, ca.descendant_concept_id, 1 FROM concept_ancestor ca ' +
      `WHERE ca.min_levels_of_separation = 1 AND ca.descendant_concept_id IN (${list}) ` +
      'UNION SELECT ca.ancestor_concept_id, anc.descendant_id, anc.depth + 1 FROM concept_ancestor ca ' +
      'JOIN anc ON ca.descendant_concept_id = anc.ancestor_id ' +
      `WHERE ca.min_levels_of_separation = 1 AND anc.depth < ${depth}) `
    source = 'anc a'
  } else {
    throw new QueryError(`Unknown hierarchy mode: ${String(mode)}`)
  }
  return {
    sql:
      `${prefix}SELECT ${CONCEPT_COLUMNS}, COUNT(DISTINCT a.descendant_id) AS covered_count, MIN(a.depth) AS min_depth ` +
      `FROM ${source} JOIN concept c ON c.concept_id = a.ancestor_id ` +
      `WHERE a.ancestor_id NOT IN (${list}) AND (c.invalid_reason IS NULL OR c.invalid_reason = '') ` +
      'GROUP BY ALL HAVING COUNT(DISTINCT a.descendant_id) >= 2 ' +
      `ORDER BY covered_count DESC, min_depth, c.concept_id LIMIT ${n}`,
    params: [],
  }
}

// --- Library metadata --------------------------------------------------------------------

export function vocabularyVersions(): SqlQuery {
  return {
    sql:
      'SELECT vocabulary_id, vocabulary_version FROM vocabulary WHERE vocabulary_version IS NOT NULL ' +
      'ORDER BY vocabulary_id',
    params: [],
  }
}

export function filterOptions(column: unknown): SqlQuery {
  if (!(FILTER_OPTION_COLUMNS as readonly unknown[]).includes(column)) {
    throw new QueryError(`Unknown filter column: ${String(column)}`)
  }
  const c = column as FilterOptionColumn
  return {
    sql: `SELECT DISTINCT ${c} AS value FROM concept WHERE ${c} IS NOT NULL AND ${c} <> '' ORDER BY value`,
    params: [],
  }
}
