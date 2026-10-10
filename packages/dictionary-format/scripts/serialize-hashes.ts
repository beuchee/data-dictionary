/**
 * Prints `{path: sha256(serialize(parse(file), {kind}))}` for the given content
 * files (paths relative to the repo root, read from argv or one per stdin line).
 * Used by the Python suite to check that both serializers emit the same bytes.
 *
 *   node --experimental-strip-types scripts/serialize-hashes.ts <repoRoot> [paths…]
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { kindForPath } from '../src/kinds.ts'
import { parse } from '../src/parse.ts'
import { serialize } from '../src/serialize.ts'

const [root, ...args] = process.argv.slice(2)
if (!root) {
  process.stderr.write('usage: serialize-hashes.ts <repoRoot> [paths…]\n')
  process.exit(2)
}
const paths = args.length ? args : readFileSync(0, 'utf8').split('\n').filter(Boolean)
const out: Record<string, string> = {}
for (const rel of paths) {
  const kind = kindForPath(rel)
  if (!kind) throw new Error(`Not a content file: ${rel}`)
  const text = serialize(parse(readFileSync(join(root, rel), 'utf8')), { kind })
  out[rel] = createHash('sha256').update(text, 'utf8').digest('hex')
}
process.stdout.write(JSON.stringify(out))
