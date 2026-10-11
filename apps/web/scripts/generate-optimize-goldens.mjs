#!/usr/bin/env node
/**
 * Golden results for `src/features/concept-sets/lib/optimize.ts` from v1's
 * "Optimize expression".
 *
 * Runs v1's own functions (`legacy/concept-sets.js`: resolveExpressionViaDuckDB,
 * runTopDownOptimization, runBottomUpOptimization, evaluateParentCandidate,
 * buildProposal), extracted from the source text and evaluated in a Node `vm`
 * context, against the API test suite's tiny ATHENA fixture
 * (`apps/api/tests/fixtures/vocab/athena/`) loaded into DuckDB-WASM (its Node
 * build) the way v1 had it in the browser: `concept_ancestor` reduced to its
 * direct parent-child rows. One change to v1's SQL, for a stable output: the
 * bottom-up candidates are also ordered by concept id (v1 left ties between
 * equally good parents in no particular order).
 *
 * Writes `src/features/concept-sets/lib/__fixtures__/v1/optimize.json`.
 * Usage (from the repo root or apps/web): node apps/web/scripts/generate-optimize-goldens.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const athena = path.join(root, 'apps/api/tests/fixtures/vocab/athena')
const outDir = path.resolve(here, '../src/features/concept-sets/lib/__fixtures__/v1')

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`function ${name} not found`)
  let depth = 0
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1)
  }
  throw new Error(`unbalanced braces in ${name}`)
}

const csJs = readFileSync(path.join(root, 'legacy/concept-sets.js'), 'utf8')
const ORDER_V1 = "'ORDER BY COUNT(DISTINCT anc.did) DESC, MIN(anc.depth) ASC ' +"
if (!csJs.includes(ORDER_V1)) throw new Error('v1 bottom-up ORDER BY not found')
const v1Source = [
  'resolveExpressionViaDuckDB',
  'runTopDownOptimization',
  'runBottomUpOptimization',
  'evaluateParentCandidate',
  'buildProposal',
]
  .map((name) => extractFunction(csJs, name))
  .join('\n\n')
  .replace(ORDER_V1, "'ORDER BY COUNT(DISTINCT anc.did) DESC, MIN(anc.depth) ASC, anc.aid ASC ' +")

// --- The fixture in DuckDB-WASM, as v1 had it ----------------------------------

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
const conn = db.connect()
for (const [table, file, where] of [
  ['concept', 'CONCEPT.csv', ''],
  ['concept_ancestor', 'CONCEPT_ANCESTOR.csv', ' WHERE min_levels_of_separation = 1'],
  ['concept_relationship', 'CONCEPT_RELATIONSHIP.csv', ''],
]) {
  db.registerFileBuffer(file, new Uint8Array(readFileSync(path.join(athena, file))))
  conn.query(`CREATE TABLE ${table} AS SELECT * FROM read_csv('${file}', delim='\t', header=true, quote='')${where}`)
}

const rows = (table) =>
  table.toArray().map((r) => {
    const o = r.toJSON()
    for (const k of Object.keys(o)) if (typeof o[k] === 'bigint') o[k] = Number(o[k])
    return o
  })
const VocabDB = { query: async (sql) => rows(conn.query(sql)) }

const context = vm.createContext({ VocabDB, Promise, Set, Number, console })
vm.runInContext(v1Source, context)
const v1 = (name) => context[name]

// --- Cases -----------------------------------------------------------------------

const item = (id, flags = {}) => ({
  concept: { conceptId: id, conceptName: `Concept ${id}` },
  isExcluded: !!flags.x,
  includeDescendants: !!flags.d,
  includeMapped: !!flags.m,
})

const CASES = [
  ['empty expression', []],
  ['one item', [item(103, { d: true })]],
  ['descendants already covered (top-down)', [item(103, { d: true }), item(104), item(106, { d: true })]],
  ['covered on the excluded side', [item(102, { d: true }), item(103, { x: true, d: true }), item(104, { x: true })]],
  ['a mapping child is kept under a non-mapping parent', [item(103, { d: true }), item(104, { m: true })]],
  ['a mapping child goes under a mapping parent', [item(103, { d: true, m: true }), item(104, { m: true })]],
  ['siblings without a gain (parent plus its own exclusion)', [item(104), item(105)]],
  ['three LOINC tests under their group', [item(300), item(301), item(302)]],
  ['three branches under one parent', [item(103, { d: true }), item(107, { d: true }), item(109, { d: true })]],
  ['both steps', [item(107, { d: true }), item(108), item(300), item(301), item(302)]],
  ['parent covering some, with an exclusion kept', [item(300), item(301), item(302), item(105, { x: true })]],
  ['an unknown id is kept', [item(999999), item(300), item(301), item(302)]],
  ['drug products', [item(401), item(402)]],
  ['mapped items', [item(200, { m: true }), item(201, { m: true }), item(104), item(107)]],
]

const brief = (items) =>
  items.map((i) => ({
    conceptId: Number(i.concept.conceptId),
    isExcluded: !!i.isExcluded,
    includeDescendants: !!i.includeDescendants,
    includeMapped: !!i.includeMapped,
  }))
const sortedIds = (set) => [...set].map(Number).sort((a, b) => a - b)

const out = []
for (const [name, items] of CASES) {
  const input = JSON.parse(JSON.stringify(items))
  const before = await v1('resolveExpressionViaDuckDB')(JSON.parse(JSON.stringify(items)))
  const td = await v1('runTopDownOptimization')(JSON.parse(JSON.stringify(items)))
  const bu = await v1('runBottomUpOptimization')(td.items)
  const changes = td.changes.concat(bu.changes)
  const after = changes.length ? await v1('resolveExpressionViaDuckDB')(bu.items) : before
  out.push({
    name,
    items: input,
    topDown: { items: brief(td.items), changes: td.changes.map((c) => ({ ...c, id: Number(c.id) })) },
    result: { items: brief(changes.length ? bu.items : items), changes: changes.map((c) => ({ ...c, id: Number(c.id) })) },
    before: sortedIds(before),
    after: sortedIds(after),
  })
}
conn.close()

mkdirSync(outDir, { recursive: true })
writeFileSync(path.join(outDir, 'optimize.json'), JSON.stringify(out, null, 2) + '\n')
console.log(`wrote ${out.length} cases to ${path.relative(root, path.join(outDir, 'optimize.json'))}`)
