/**
 * Pure pieces of the browser import of an ATHENA export (ported from v1
 * `legacy/duckdb-loader.js`, typed like the server's import in
 * apps/api/app/services/vocabulary.py): which file holds which table, and the
 * SQL that loads each table.
 *
 * What the browser keeps, to fit in memory (as v1):
 * - `concept` in full;
 * - `concept_ancestor` reduced to its direct parent-child rows (hierarchy
 *   queries walk them, see sql.ts `edges` mode);
 * - `concept_relationship` and `concept_synonym` only for the concepts of the
 *   dictionary's resolved lists (`data/resolved_concept_ids.json`), in full when
 *   that list is missing;
 * - the small reference tables in full. `drug_strength` is not loaded.
 */

/** Column types of the OMOP CDM v5.4 vocabulary tables (as the server's TABLE_COLUMNS). */
export const TABLE_COLUMNS: Record<string, [string, string][]> = {
  concept: [
    ['concept_id', 'BIGINT'], ['concept_name', 'VARCHAR'], ['domain_id', 'VARCHAR'],
    ['vocabulary_id', 'VARCHAR'], ['concept_class_id', 'VARCHAR'],
    ['standard_concept', 'VARCHAR'], ['concept_code', 'VARCHAR'],
    ['valid_start_date', 'DATE'], ['valid_end_date', 'DATE'], ['invalid_reason', 'VARCHAR'],
  ],
  concept_relationship: [
    ['concept_id_1', 'BIGINT'], ['concept_id_2', 'BIGINT'], ['relationship_id', 'VARCHAR'],
    ['valid_start_date', 'DATE'], ['valid_end_date', 'DATE'], ['invalid_reason', 'VARCHAR'],
  ],
  concept_ancestor: [
    ['ancestor_concept_id', 'BIGINT'], ['descendant_concept_id', 'BIGINT'],
    ['min_levels_of_separation', 'INTEGER'], ['max_levels_of_separation', 'INTEGER'],
  ],
  concept_synonym: [['concept_id', 'BIGINT'], ['concept_synonym_name', 'VARCHAR'], ['language_concept_id', 'BIGINT']],
  vocabulary: [
    ['vocabulary_id', 'VARCHAR'], ['vocabulary_name', 'VARCHAR'], ['vocabulary_reference', 'VARCHAR'],
    ['vocabulary_version', 'VARCHAR'], ['vocabulary_concept_id', 'BIGINT'],
  ],
  domain: [['domain_id', 'VARCHAR'], ['domain_name', 'VARCHAR'], ['domain_concept_id', 'BIGINT']],
  concept_class: [['concept_class_id', 'VARCHAR'], ['concept_class_name', 'VARCHAR'], ['concept_class_concept_id', 'BIGINT']],
  relationship: [
    ['relationship_id', 'VARCHAR'], ['relationship_name', 'VARCHAR'], ['is_hierarchical', 'VARCHAR'],
    ['defines_ancestry', 'VARCHAR'], ['reverse_relationship_id', 'VARCHAR'], ['relationship_concept_id', 'BIGINT'],
  ],
}

export type AthenaTable = keyof typeof TABLE_COLUMNS
export const ATHENA_TABLES = Object.keys(TABLE_COLUMNS)
export const REQUIRED_TABLES = ['concept', 'concept_ancestor', 'concept_relationship']
/** Loaded only for the dictionary's concepts when the id list is available. */
export const FILTERED_TABLES = ['concept_relationship', 'concept_synonym']

const DATA_FILE = /^(.+)\.(csv|tsv|txt|parquet|pq)$/i

/** Read by the server's import only (the browser does not keep it). */
export const SERVER_ONLY_TABLES = ['drug_strength']

/** The table a file holds (`CONCEPT.csv` → `concept`), or null; `extra` adds table names. */
export function tableOfFile(name: string, extra: readonly string[] = []): string | null {
  const base = name.split(/[\\/]/).pop() ?? ''
  const match = DATA_FILE.exec(base)
  if (!match) return null
  const table = match[1].toLowerCase()
  return table in TABLE_COLUMNS || extra.includes(table) ? table : null
}

export const isParquetName = (name: string) => /\.(parquet|pq)$/i.test(name)

/** One file per table, Parquet preferred over CSV (v1's rule). */
export function pickAthenaFiles<T extends { name: string }>(files: readonly T[], extra: readonly string[] = []): Map<string, T> {
  const picked = new Map<string, T>()
  for (const f of files) {
    const table = tableOfFile(f.name, extra)
    if (!table) continue
    const current = picked.get(table)
    if (!current || (isParquetName(f.name) && !isParquetName(current.name))) picked.set(table, f)
  }
  return picked
}

export function missingTables(picked: ReadonlyMap<string, unknown>): string[] {
  return REQUIRED_TABLES.filter((t) => !picked.has(t))
}

export const lit = (value: string) => `'${value.replace(/\0/g, '').replace(/'/g, "''")}'`

/** The name a file is registered under in DuckDB: ours, never the user's. */
export function registeredName(table: string, fileName: string): string {
  if (!(table in TABLE_COLUMNS)) throw new Error(`Unknown table: ${table}`)
  return `athena_${table}.${isParquetName(fileName) ? 'parquet' : 'csv'}`
}

/** A reader over one registered file. ATHENA CSVs are tab-separated and never
 *  quoted (a concept name may hold a lone `"`): a tab header switches quoting
 *  off. Everything is read as text, then cast by `typedSelectSql`. */
export function readerSql(registered: string, headerLine: string): string {
  if (isParquetName(registered)) return `read_parquet(${lit(registered)})`
  const opts = headerLine.includes('\t') ? "delim='\\t', quote='', escape=''" : 'auto_detect=true'
  return `read_csv(${lit(registered)}, header=true, all_varchar=true, ${opts})`
}

function typedColumn(name: string, type: string, present: ReadonlySet<string>): string {
  if (!present.has(name)) return `CAST(NULL AS ${type}) AS ${name}`
  if (type === 'DATE') {
    // ATHENA writes 19700101; a typed Parquet already has a DATE.
    return `COALESCE(TRY_CAST(${name} AS DATE), TRY_STRPTIME(CAST(${name} AS VARCHAR), '%Y%m%d')::DATE) AS ${name}`
  }
  return `TRY_CAST(${name} AS ${type}) AS ${name}`
}

/** The table's columns, typed, from `reader` (whose columns are `present`, any case). */
export function typedSelectSql(table: string, reader: string, present: readonly string[]): string {
  const columns = TABLE_COLUMNS[table]
  if (!columns) throw new Error(`Unknown table: ${table}`)
  const have = new Set(present.map((c) => c.toLowerCase()))
  return `SELECT ${columns.map(([n, t]) => typedColumn(n, t, have)).join(', ')} FROM ${reader}`
}

/** `CREATE TABLE` for one table, with the browser's row selection. */
export function createTableSql(table: string, typedSelect: string, filtered: boolean): string {
  let where = ''
  if (table === 'concept_ancestor') where = ' WHERE min_levels_of_separation = 1'
  else if (filtered && table === 'concept_relationship') {
    where = ' WHERE concept_id_1 IN (SELECT id FROM _filter_ids) OR concept_id_2 IN (SELECT id FROM _filter_ids)'
  } else if (filtered && table === 'concept_synonym') where = ' WHERE concept_id IN (SELECT id FROM _filter_ids)'
  return `CREATE TABLE ${table} AS SELECT * FROM (${typedSelect})${where}`
}

/** An empty table of the right shape, for an optional table the export lacks. */
export function emptyTableSql(table: string): string {
  const columns = TABLE_COLUMNS[table]
  if (!columns) throw new Error(`Unknown table: ${table}`)
  return `CREATE TABLE ${table} AS SELECT ${columns.map(([n, t]) => `CAST(NULL AS ${t}) AS ${n}`).join(', ')} WHERE false`
}

/** `INSERT` statements for the filter ids, in batches; non-integers dropped. */
export function filterIdInserts(ids: readonly unknown[], batch = 1000): string[] {
  const valid = ids.filter((id): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id >= 0)
  const out: string[] = []
  for (let i = 0; i < valid.length; i += batch) {
    out.push(`INSERT INTO _filter_ids VALUES ${valid.slice(i, i + batch).map((id) => `(${id})`).join(', ')}`)
  }
  return out
}

export const INDEXES = [
  'CREATE INDEX idx_concept_id ON concept(concept_id)',
  'CREATE INDEX idx_ancestor ON concept_ancestor(ancestor_concept_id)',
  'CREATE INDEX idx_descendant ON concept_ancestor(descendant_concept_id)',
  'CREATE INDEX idx_concept_rel_1 ON concept_relationship(concept_id_1)',
  'CREATE INDEX idx_synonym_cid ON concept_synonym(concept_id)',
]
