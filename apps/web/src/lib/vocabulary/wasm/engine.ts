// Adapted from linkr@1310cf4a4 apps/web/src/lib/duckdb/engine.ts (the DuckDB-WASM
// singleton only: no data sources, attach or server mode here).

// Type-only import: the DuckDB-WASM glue is loaded on demand (`loadModule`), so
// it lands in its own chunk and a page that never touches the vocabulary does
// not download it.
import type * as duckdb from '@duckdb/duckdb-wasm'
import type { Row } from '../rows'

// Copied into public/duckdb/ by scripts/postinstall.mjs. BASE_URL keeps them
// resolvable under a sub-path deployment.
const asset = (file: string) =>
  new URL(`${import.meta.env.BASE_URL ?? '/'}duckdb/${file}`, globalThis.location?.href ?? 'http://localhost/').href

let modulePromise: Promise<typeof import('@duckdb/duckdb-wasm')> | null = null
let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null
let connPromise: Promise<duckdb.AsyncDuckDBConnection> | null = null
let worker: Worker | null = null

export function loadModule(): Promise<typeof import('@duckdb/duckdb-wasm')> {
  modulePromise ??= import('@duckdb/duckdb-wasm')
  return modulePromise
}

async function instantiate(workerFile: string, wasmFile: string, label: string): Promise<duckdb.AsyncDuckDB> {
  const mod = await loadModule()
  worker = new Worker(asset(workerFile))
  worker.addEventListener('error', (e) => console.error(`[DuckDB:${label}] worker error:`, e.message))
  // WARNING: DuckDB-WASM otherwise logs every query to the console.
  const db = new mod.AsyncDuckDB(new mod.ConsoleLogger(mod.LogLevel.WARNING), worker)
  await Promise.race([
    db.instantiate(asset(wasmFile)),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`DuckDB ${label} instantiate timed out`)), 15_000)),
  ])
  await db.open({ path: ':memory:' })
  // Parquet is built in; the autoloader would try (and fail) to fetch it from the CDN.
  const conn = await db.connect()
  try {
    await conn.query('SET autoinstall_known_extensions = false')
    await conn.query('SET autoload_known_extensions = false')
    await conn.query('LOAD parquet')
  } finally {
    await conn.close()
  }
  return db
}

/** The DuckDB-WASM singleton: the EH bundle, else MVP. */
export function getDuckDB(): Promise<duckdb.AsyncDuckDB> {
  dbPromise ??= (async () => {
    try {
      return await instantiate('duckdb-browser-eh.worker.js', 'duckdb-eh.wasm', 'eh')
    } catch (ehError) {
      console.warn('[DuckDB] EH bundle failed, falling back to MVP:', ehError)
      worker?.terminate()
      worker = null
    }
    return instantiate('duckdb-browser-mvp.worker.js', 'duckdb-mvp.wasm', 'mvp')
  })().catch((error) => {
    dbPromise = null
    throw error
  })
  return dbPromise
}

/** One shared connection: DuckDB-WASM queues its queries. */
export function getConnection(): Promise<duckdb.AsyncDuckDBConnection> {
  connPromise ??= getDuckDB()
    .then((db) => db.connect())
    .catch((error) => {
      connPromise = null
      throw error
    })
  return connPromise
}

function toRows(table: { toArray(): { toJSON(): Row }[] }): Row[] {
  return table.toArray().map((r) => {
    const row = r.toJSON()
    for (const key of Object.keys(row)) {
      if (typeof row[key] === 'bigint') row[key] = Number(row[key])
    }
    return row
  })
}

/** Run one statement; `params` bind `$1`, `$2`… through a prepared statement. */
export async function query(sql: string, params: readonly unknown[] = []): Promise<Row[]> {
  const conn = await getConnection()
  if (!params.length) return toRows(await conn.query(sql))
  const stmt = await conn.prepare(sql)
  try {
    return toRows(await stmt.query(...params))
  } finally {
    await stmt.close()
  }
}

/** Column names a query would return, without running it. */
export async function columnsOf(sql: string): Promise<string[]> {
  const conn = await getConnection()
  const result = await conn.query(`SELECT * FROM (${sql}) LIMIT 0`)
  return result.schema.fields.map((f) => f.name)
}

/** Terminate the worker; the next call starts a fresh, empty database. */
export async function resetDuckDB(): Promise<void> {
  const db = dbPromise ? await dbPromise.catch(() => null) : null
  connPromise = null
  dbPromise = null
  await db?.terminate().catch(() => undefined)
  worker = null
}
