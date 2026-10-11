/**
 * The browser's vocabulary (static mode), ported from v1 `legacy/duckdb-loader.js`:
 * an ATHENA folder picked by the user is loaded into DuckDB-WASM (see
 * athena-files.ts for what is kept), exported to Parquet and stored in
 * IndexedDB (persist.ts), and restored from there on the next visit.
 */
import {
  ATHENA_TABLES,
  INDEXES,
  createTableSql,
  emptyTableSql,
  filterIdInserts,
  isParquetName,
  lit,
  missingTables,
  pickAthenaFiles,
  readerSql,
  registeredName,
  typedSelectSql,
} from './athena-files'
import { columnsOf, getDuckDB, loadModule, query, resetDuckDB } from './engine'
import { STORE_FORMAT_VERSION, clearVocabulary, readFiles, readMeta, storeVocabulary, type StoredVocabularyMeta } from './persist'

const EXPORT_DIR = '/dd-vocabulary'

export type WasmImportStep = 'filter_ids' | 'table' | 'indexing' | 'persisting' | 'done'

export interface WasmImportProgress {
  step: WasmImportStep
  /** The table being loaded (step `table`). */
  table?: string
  done: number
  total: number
}

export class MissingTablesError extends Error {
  readonly tables: string[]

  constructor(tables: string[]) {
    super(`Missing ATHENA tables: ${tables.join(', ')}`)
    this.name = 'MissingTablesError'
    this.tables = tables
  }
}

export interface WasmImportResult {
  meta: StoredVocabularyMeta
  /** False when IndexedDB refused the copy (quota): the vocabulary lasts until the tab closes. */
  persisted: boolean
}

let mounted = false
let mountPromise: Promise<boolean> | null = null
const listeners = new Set<() => void>()

/** Called whenever the browser vocabulary is loaded, replaced or removed. */
export function onVocabularyChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function changed(): void {
  for (const listener of listeners) listener()
}

async function headerLine(file: Blob): Promise<string> {
  const head = await file.slice(0, 64 * 1024).text()
  return head.split(/\r?\n/, 1)[0] ?? ''
}

async function resolvedConceptIds(): Promise<unknown[]> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL ?? '/'}data/resolved_concept_ids.json`)
    if (!res.ok) return []
    const ids: unknown = await res.json()
    return Array.isArray(ids) ? ids : []
  } catch {
    return []
  }
}

async function persist(meta: StoredVocabularyMeta): Promise<boolean> {
  try {
    const db = await getDuckDB()
    await query(`EXPORT DATABASE ${lit(EXPORT_DIR)} (FORMAT PARQUET)`)
    // The names EXPORT DATABASE writes (as v1 listed them), plus whatever the glob finds.
    const names = new Set([
      `${EXPORT_DIR}/schema.sql`,
      `${EXPORT_DIR}/load.sql`,
      ...ATHENA_TABLES.map((t) => `${EXPORT_DIR}/${t}.parquet`),
    ])
    for (const f of await db.globFiles(`${EXPORT_DIR}/*`).catch(() => [])) names.add(f.fileName)
    const files = new Map<string, Uint8Array>()
    for (const name of names) {
      const bytes = await db.copyFileToBuffer(name).catch(() => null)
      if (bytes?.byteLength) files.set(name, bytes)
    }
    if (!files.has(`${EXPORT_DIR}/schema.sql`)) return false
    await storeVocabulary(files, meta)
    return true
  } catch (error) {
    console.warn('Could not keep the vocabulary in IndexedDB:', error)
    return false
  }
}

/**
 * Load an ATHENA export (the files of a folder: `CONCEPT.csv` or `.parquet`…)
 * into a fresh browser database, replacing any previous one, then keep it in
 * IndexedDB. Rejects with `MissingTablesError` when a required table is absent.
 */
export async function importAthenaFiles(
  files: readonly File[],
  source: string,
  onProgress: (p: WasmImportProgress) => void = () => {},
): Promise<WasmImportResult> {
  const picked = pickAthenaFiles(files.map((file) => ({ name: file.webkitRelativePath || file.name, file })))
  const missing = missingTables(picked)
  if (missing.length) throw new MissingTablesError(missing)

  mounted = false
  mountPromise = null
  await resetDuckDB()
  const db = await getDuckDB()
  const mod = await loadModule()
  const total = ATHENA_TABLES.length + 3
  let done = 0
  try {
    onProgress({ step: 'filter_ids', done, total })
    const inserts = filterIdInserts(await resolvedConceptIds())
    const filtered = inserts.length > 0
    if (filtered) {
      await query('CREATE TEMP TABLE _filter_ids (id BIGINT)')
      for (const sql of inserts) await query(sql)
    }
    onProgress({ step: 'filter_ids', done: ++done, total })

    const registered: string[] = []
    for (const table of ATHENA_TABLES) {
      onProgress({ step: 'table', table, done, total })
      const entry = picked.get(table)
      if (!entry) {
        await query(emptyTableSql(table))
      } else {
        const name = registeredName(table, entry.name)
        await db.registerFileHandle(name, entry.file, mod.DuckDBDataProtocol.BROWSER_FILEREADER, true)
        registered.push(name)
        const reader = readerSql(name, isParquetName(name) ? '' : await headerLine(entry.file))
        const typed = typedSelectSql(table, reader, await columnsOf(`SELECT * FROM ${reader}`))
        await query(createTableSql(table, typed, filtered))
      }
      onProgress({ step: 'table', table, done: ++done, total })
    }

    onProgress({ step: 'indexing', done, total })
    for (const sql of INDEXES) await query(sql).catch(() => undefined)
    if (filtered) await query('DROP TABLE IF EXISTS _filter_ids')
    await db.dropFiles(registered).catch(() => undefined)
    onProgress({ step: 'indexing', done: ++done, total })

    const rowCounts: Record<string, number> = {}
    for (const table of ATHENA_TABLES) {
      rowCounts[table] = Number((await query(`SELECT COUNT(*) AS n FROM ${table}`))[0]?.n ?? 0)
    }
    const meta: StoredVocabularyMeta = {
      formatVersion: STORE_FORMAT_VERSION,
      importedAt: new Date().toISOString(),
      source,
      rowCounts,
      filtered,
    }
    onProgress({ step: 'persisting', done, total })
    const persisted = await persist(meta)
    mounted = true
    onProgress({ step: 'done', done: ++done, total })
    changed()
    return { meta, persisted }
  } catch (error) {
    await resetDuckDB()
    throw error
  }
}

async function restore(): Promise<boolean> {
  const meta = await readMeta()
  if (!meta) return false
  const files = await readFiles()
  if (![...files.keys()].some((f) => f.endsWith('schema.sql'))) return false
  const db = await getDuckDB()
  for (const [path, bytes] of files) await db.registerFileBuffer(path, bytes)
  await query(`IMPORT DATABASE ${lit(EXPORT_DIR)}`)
  return true
}

/** Whether a vocabulary is loaded, restoring the stored one on first call. */
export function ensureMounted(): Promise<boolean> {
  if (mounted) return Promise.resolve(true)
  mountPromise ??= restore()
    .then((ok) => {
      mounted = ok
      if (!ok) mountPromise = null
      return ok
    })
    .catch(async (error) => {
      console.warn('Could not restore the stored vocabulary:', error)
      mountPromise = null
      await resetDuckDB()
      return false
    })
  return mountPromise
}

export function storedMeta(): Promise<StoredVocabularyMeta | null> {
  return readMeta().catch(() => null)
}

/** Drop the browser vocabulary: the database and its IndexedDB copy. */
export async function removeBrowserVocabulary(): Promise<void> {
  mounted = false
  mountPromise = null
  await resetDuckDB()
  await clearVocabulary()
  changed()
}
