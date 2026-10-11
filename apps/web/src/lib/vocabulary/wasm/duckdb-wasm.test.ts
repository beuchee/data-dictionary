import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { createRequire } from 'module'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ExpressionItem, ResolvedConcept } from '@data-dictionary/format'
import { resolveItems, sqlLookup, stampVersion, versionFromRows } from '../resolver'
import type { Row } from '../rows'
import * as sql from '../sql'
import {
  ATHENA_TABLES,
  INDEXES,
  createTableSql,
  emptyTableSql,
  filterIdInserts,
  pickAthenaFiles,
  readerSql,
  registeredName,
  typedSelectSql,
} from './athena-files'

/**
 * The browser path for real: DuckDB-WASM (its Node build, same engine and
 * version as the browser's) loads the fixture ATHENA export with the import
 * SQL of athena-files.ts, then runs the shared builders and the resolver.
 */
const FIXTURE = path.resolve(__dirname, '../../../../../api/tests/fixtures/vocab')
const golden = JSON.parse(readFileSync(path.join(FIXTURE, 'sql-golden.json'), 'utf-8')) as {
  cases: { builder: string; input: Record<string, unknown>; output: { sql?: string; page?: sql.SqlQuery } }[]
}
const cases = JSON.parse(readFileSync(path.join(FIXTURE, 'resolve-cases.json'), 'utf-8')) as {
  name: string
  items: ExpressionItem[]
  vocabularyVersion: Record<string, string | null>
  resolvedConcepts: ResolvedConcept[]
}[]

/** The concepts of a pretend dictionary: only they keep their relationships and synonyms. */
const DICTIONARY_IDS = [103, 104, 120, 200, 300, 600]

interface Conn {
  query(sql: string): { toArray(): { toJSON(): Row }[]; schema: { fields: { name: string }[] } }
  prepare(sql: string): { query(...p: unknown[]): { toArray(): { toJSON(): Row }[] }; close(): void }
  close(): void
}

let db: { connect(): Conn; registerFileBuffer(n: string, b: Uint8Array): void } | null = null
let conn: Conn

const rows = (t: { toArray(): { toJSON(): Row }[] }): Row[] =>
  t.toArray().map((r) => {
    const o = r.toJSON()
    for (const k of Object.keys(o)) if (typeof o[k] === 'bigint') o[k] = Number(o[k])
    return o
  })

function run(query: sql.SqlQuery): Row[] {
  if (!query.params.length) return rows(conn.query(query.sql))
  const stmt = conn.prepare(query.sql)
  try {
    return rows(stmt.query(...query.params))
  } finally {
    stmt.close()
  }
}

type Db = { connect(): Conn; registerFileBuffer(n: string, b: Uint8Array): void }

async function newDb(): Promise<Db> {
  const require = createRequire(import.meta.url)
  const duckdb = require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs')
  const dist = path.dirname(require.resolve('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs'))
  const bundles = {
    mvp: { mainModule: path.join(dist, 'duckdb-mvp.wasm'), mainWorker: path.join(dist, 'duckdb-node-mvp.worker.cjs') },
    eh: { mainModule: path.join(dist, 'duckdb-eh.wasm'), mainWorker: path.join(dist, 'duckdb-node-eh.worker.cjs') },
  }
  const created = await duckdb.createDuckDB(bundles, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME)
  await created.instantiate()
  return created as Db
}

beforeAll(async () => {
  db = await newDb()
  conn = db.connect()

  const files = readdirSync(path.join(FIXTURE, 'athena')).map((name) => ({ name }))
  const picked = pickAthenaFiles(files)
  conn.query('CREATE TEMP TABLE _filter_ids (id BIGINT)')
  for (const s of filterIdInserts(DICTIONARY_IDS)) conn.query(s)
  for (const table of ATHENA_TABLES) {
    const entry = picked.get(table)
    if (!entry) {
      conn.query(emptyTableSql(table))
      continue
    }
    const name = registeredName(table, entry.name)
    const bytes = readFileSync(path.join(FIXTURE, 'athena', entry.name))
    db!.registerFileBuffer(name, new Uint8Array(bytes))
    const reader = readerSql(name, bytes.toString('utf-8').split('\n', 1)[0])
    const present = conn.query(`SELECT * FROM (SELECT * FROM ${reader}) LIMIT 0`).schema.fields.map((f) => f.name)
    conn.query(createTableSql(table, typedSelectSql(table, reader, present), true))
  }
  for (const sql of INDEXES) conn.query(sql)
  conn.query('DROP TABLE _filter_ids')
}, 60_000)

afterAll(() => {
  conn?.close()
})

describe('DuckDB-WASM', () => {
  it('keeps direct ancestor edges and the dictionary relationships only', () => {
    expect(run({ sql: 'SELECT COUNT(*) AS n FROM concept_ancestor WHERE min_levels_of_separation <> 1', params: [] })[0].n).toBe(0)
    const kept = DICTIONARY_IDS
    const pairs = run({ sql: 'SELECT concept_id_1 AS a, concept_id_2 AS b FROM concept_relationship', params: [] })
    expect(pairs.length).toBeGreaterThan(0)
    expect(pairs.every((r) => kept.includes(r.a as number) || kept.includes(r.b as number))).toBe(true)
    expect(pairs.some((r) => r.a === 202 || r.b === 202)).toBe(false)
    expect(run(sql.conceptById(120))[0].valid_end_date).toBe('2020-01-01')
  })

  it('runs every golden query', () => {
    for (const c of golden.cases) {
      const query = (c.output.page ?? c.output) as sql.SqlQuery
      expect(() => run(query), `${c.builder} ${JSON.stringify(c.input)}`).not.toThrow()
    }
  })

  it('ranks a search with bound parameters', () => {
    const { page, count } = sql.conceptSearch({ term: 'heart failure' })
    expect(run(page).slice(0, 3).map((r) => r.concept_id)).toEqual([107, 201, 108])
    expect(run(count)[0].total).toBe(run(page).length)
    expect(run(sql.conceptSearch({ term: 'menieres' }).page)[0].concept_id).toBe(112)
    expect(run(sql.conceptSearch({ term: "x' OR 1=1 --" }).page)).toEqual([])
  })

  it('walks the hierarchy from direct edges', () => {
    const nodes = run(sql.hierarchyNodes(109, 'edges'))
    expect(Object.fromEntries(nodes.map((n) => [n.concept_id, n.hierarchy_level]))).toEqual({
      109: 0, 102: -1, 110: -1, 101: -2, 100: -3,
    })
  })

  it.each(cases.map((c) => [c.name, c] as const))('resolves like resolve.py: %s', async (_, c) => {
    // Mapping reads concept_relationship, which the browser cut to the dictionary's
    // concepts: compare only the cases whose mapped items are among them.
    const mappedIds = c.items.filter((i) => i.includeMapped).map((i) => i.concept.conceptId)
    if (!mappedIds.every((id) => DICTIONARY_IDS.includes(id))) return
    const resolved = await resolveItems(c.items, sqlLookup(async (q) => run(q), 'edges'))
    expect(resolved).toEqual(c.resolvedConcepts)
    expect(stampVersion(versionFromRows(run(sql.vocabularyVersions())), resolved)).toEqual(c.vocabularyVersion)
  })

  it('survives an EXPORT / IMPORT DATABASE round trip (the IndexedDB copy)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dd-vocab-'))
    try {
      conn.query(`EXPORT DATABASE '${dir}' (FORMAT PARQUET)`)
      const other = (await newDb()).connect()
      other.query(`IMPORT DATABASE '${dir}'`)
      for (const table of ATHENA_TABLES) {
        const count = (c: Conn) => Number(rows(c.query(`SELECT COUNT(*) AS n FROM ${table}`))[0].n)
        expect(count(other), table).toBe(count(conn))
      }
      expect(rows(other.query(sql.conceptById(112).sql))[0].concept_name).toBe("Ménière's disease")
      other.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
