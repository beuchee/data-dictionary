import { readFileSync } from 'fs'
import { createRequire } from 'module'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { candidateFromRow, conceptFromRow, num, type Row } from '@/lib/vocabulary/rows'
import * as sql from '@/lib/vocabulary/sql'
import { optimizeExpression, topDown, type OptimizeLookup } from './optimize'
import type { ExpressionItem } from '@data-dictionary/format'

/**
 * v1's "Optimize expression" (goldens from scripts/generate-optimize-goldens.mjs,
 * which runs v1's own functions) against the port, on the same ATHENA fixture in
 * DuckDB-WASM, through the shared SQL builders: once on direct edges (the
 * browser) and once on the full closure (the server).
 */
const ATHENA = path.resolve(__dirname, '../../../../../api/tests/fixtures/vocab/athena')

interface Brief {
  conceptId: number
  isExcluded: boolean
  includeDescendants: boolean
  includeMapped: boolean
}
interface Change extends Omit<Brief, 'conceptId'> {
  action: 'removed' | 'added'
  id: number
}
interface Golden {
  name: string
  items: ExpressionItem[]
  topDown: { items: Brief[]; changes: Change[] }
  result: { items: Brief[]; changes: Change[] }
  before: number[]
  after: number[]
}

const goldens = JSON.parse(readFileSync(path.join(__dirname, '__fixtures__/v1/optimize.json'), 'utf-8')) as Golden[]

interface Conn {
  query(sql: string): { toArray(): { toJSON(): Row }[] }
  close(): void
}

async function openDb(edgesOnly: boolean): Promise<Conn> {
  const require = createRequire(import.meta.url)
  const duckdb = require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs')
  const dist = path.dirname(require.resolve('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs'))
  const db = await duckdb.createDuckDB(
    {
      mvp: { mainModule: path.join(dist, 'duckdb-mvp.wasm'), mainWorker: path.join(dist, 'duckdb-node-mvp.worker.cjs') },
      eh: { mainModule: path.join(dist, 'duckdb-eh.wasm'), mainWorker: path.join(dist, 'duckdb-node-eh.worker.cjs') },
    },
    new duckdb.VoidLogger(),
    duckdb.NODE_RUNTIME,
  )
  await db.instantiate()
  const conn = db.connect() as Conn
  for (const [table, file, where] of [
    ['concept', 'CONCEPT.csv', ''],
    ['concept_ancestor', 'CONCEPT_ANCESTOR.csv', edgesOnly ? ' WHERE min_levels_of_separation = 1' : ''],
    ['concept_relationship', 'CONCEPT_RELATIONSHIP.csv', ''],
  ]) {
    db.registerFileBuffer(file, new Uint8Array(readFileSync(path.join(ATHENA, file))))
    conn.query(`CREATE TABLE ${table} AS SELECT * FROM read_csv('${file}', delim='\t', header=true, quote='')${where}`)
  }
  return conn
}

function lookupOn(conn: Conn, mode: sql.HierarchyMode): OptimizeLookup {
  const run = (q: sql.SqlQuery): Row[] =>
    conn
      .query(q.sql)
      .toArray()
      .map((r) => r.toJSON())
  return {
    getDescendantPairs: async (ancestors, within = null) =>
      run(sql.descendantPairs(ancestors, mode, within)).map((r) => ({ ancestorId: num(r.ancestor_id), descendantId: num(r.descendant_id) })),
    getMappedIds: async (ids) => run(sql.mappedIds(ids)).map((r) => num(r.concept_id)),
    getAncestorCandidates: async (ids, q = {}) => run(sql.ancestorCandidates(ids, mode, q.maxDepth ?? 5, q.limit ?? 30)).map(candidateFromRow),
    getConcepts: async (ids) => run(sql.conceptsByIds(ids)).map(conceptFromRow),
  }
}

const brief = (items: ExpressionItem[]): Brief[] =>
  items.map((i) => ({
    conceptId: i.concept.conceptId,
    isExcluded: i.isExcluded,
    includeDescendants: i.includeDescendants,
    includeMapped: i.includeMapped,
  }))
const byId = <T extends { conceptId: number; isExcluded: boolean }>(a: T, b: T) => a.conceptId - b.conceptId || Number(a.isExcluded) - Number(b.isExcluded)
const changeKey = (c: Change) => `${c.action}:${c.id}:${c.isExcluded}:${c.includeDescendants}:${c.includeMapped}`

const conns: Conn[] = []
const modes: [sql.HierarchyMode, OptimizeLookup][] = []

beforeAll(async () => {
  const edges = await openDb(true)
  const closure = await openDb(false)
  conns.push(edges, closure)
  modes.push(['edges', lookupOn(edges, 'edges')], ['closure', lookupOn(closure, 'closure')])
}, 60_000)

afterAll(() => {
  for (const c of conns) c.close()
})

describe('optimizeExpression matches v1', () => {
  it.each(goldens.map((g) => [g.name, g] as const))('%s', async (_, g) => {
    for (const [mode, lookup] of modes) {
      const td = await topDown(lookup, g.items)
      expect(brief(td.items), mode).toEqual(g.topDown.items)
      expect(td.changes.map((c) => ({ ...c, name: undefined })), mode).toEqual(g.topDown.changes.map((c) => ({ ...c, name: undefined })))

      const result = await optimizeExpression(lookup, g.items)
      // v1 appended the new exclusions in the database's order: compare as sets.
      expect(brief(result.items).sort(byId), mode).toEqual([...g.result.items].sort(byId))
      expect(result.changes.map(changeKey).sort(), mode).toEqual(g.result.changes.map(changeKey).sort())
      expect([...result.before].sort((a, b) => a - b), mode).toEqual(g.before)
      expect([...result.after].sort((a, b) => a - b), mode).toEqual(g.after)
      expect(result.identical, mode).toBe(g.before.join() === g.after.join())
    }
  })

  it('takes the new items’ metadata from the vocabulary', async () => {
    const [, lookup] = modes[0]
    const g = goldens.find((x) => x.name === 'three LOINC tests under their group')!
    const result = await optimizeExpression(lookup, g.items)
    const parent = result.items.find((i) => i.concept.conceptId === 310 && !i.isExcluded)!
    expect(parent.concept).toMatchObject({
      conceptName: 'Vital signs',
      vocabularyId: 'LOINC',
      standardConcept: 'C',
      standardConceptCaption: 'Classification',
      conceptCode: 'LG41810-1',
      invalidReasonCaption: 'Valid',
    })
    expect(parent.concept.validStartDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
