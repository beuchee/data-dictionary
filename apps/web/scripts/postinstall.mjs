// Adapted from linkr@1310cf4a4 apps/web/scripts/postinstall.mjs
/**
 * Post-install: copies the DuckDB-WASM bundles and coi-serviceworker to public/
 * (gitignored), where the app loads them from. Works with hoisted (monorepo) and
 * local node_modules.
 */
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const webRoot = resolve(__dirname, '..')

function findPkg(name) {
  const local = resolve(webRoot, 'node_modules', name)
  if (existsSync(local)) return local
  const root = resolve(webRoot, '..', '..', 'node_modules', name)
  if (existsSync(root)) return root
  throw new Error(`Cannot find package "${name}" in node_modules`)
}

const duckdb = findPkg('@duckdb/duckdb-wasm')
const coi = findPkg('coi-serviceworker')

const publicDir = resolve(webRoot, 'public')
const duckdbDir = resolve(publicDir, 'duckdb')
mkdirSync(duckdbDir, { recursive: true })

for (const file of ['duckdb-mvp.wasm', 'duckdb-eh.wasm', 'duckdb-browser-mvp.worker.js', 'duckdb-browser-eh.worker.js']) {
  const dest = resolve(duckdbDir, file)
  copyFileSync(resolve(duckdb, 'dist', file), dest)
  // The workers end on a sourceMappingURL comment but the .map files are not
  // copied: the browser would ask for them and log a parse error on each load.
  if (file.endsWith('.js')) {
    const src = readFileSync(dest, 'utf8')
    const stripped = src.replace(/\n?\/\/# sourceMappingURL=.*\s*$/m, '')
    if (stripped !== src) writeFileSync(dest, stripped)
  }
}

const coiDest = resolve(publicDir, 'coi-serviceworker.js')
copyFileSync(resolve(coi, 'coi-serviceworker.js'), coiDest)

// Firefox: the vanilla fetch handler's `.catch` resolves respondWith() with
// undefined. Return a fallback Response instead. Idempotent; fails loudly if a
// package upgrade changes the code, so the patch gets re-checked.
const PATCH_TARGET = '.catch((e) => console.error(e))'
const PATCH_REPLACEMENT = '.catch((e) => { console.error(e); return fetch(request); })'
let coiSource = readFileSync(coiDest, 'utf8')
if (!coiSource.includes(PATCH_REPLACEMENT)) {
  if (!coiSource.includes(PATCH_TARGET)) {
    throw new Error(
      `postinstall: cannot apply the Firefox patch to coi-serviceworker.js: ${JSON.stringify(PATCH_TARGET)} not found (did coi-serviceworker change version?)`,
    )
  }
  coiSource = coiSource.replace(PATCH_TARGET, PATCH_REPLACEMENT)
  writeFileSync(coiDest, coiSource)
}

console.log('postinstall: copied DuckDB-WASM + coi-serviceworker (Firefox-patched) to public/')
