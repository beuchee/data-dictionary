/** Shared by the test files: the real content files of this repository. */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { kindForPath, type FileKind } from './kinds.ts'

export const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
export const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

const ID_DIRS = ['concept_sets', 'concept_sets_resolved', 'projects']
const FIXED = [
  'units/recommended_units.json',
  'units/unit_conversions.json',
  'mapping_recommendations/mapping_recommendations.json',
  'config.json',
  'id_counters.json',
  'concept_sets_versions.json',
]

export interface ContentFile {
  path: string
  kind: FileKind
}

/** Every content file of the repo, paths relative to its root. */
export function contentFiles(): ContentFile[] {
  const paths = [
    ...ID_DIRS.flatMap((dir) =>
      readdirSync(join(REPO_ROOT, dir))
        .filter((f) => f.endsWith('.json'))
        .map((f) => `${dir}/${f}`),
    ),
    ...FIXED,
  ]
  return paths.map((path) => {
    const kind = kindForPath(path)
    if (!kind) throw new Error(`unexpected file ${path}`)
    return { path, kind }
  })
}

export function readRepoFile(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8')
}

/** Files that are knowingly not in canonical form today, with why. */
export const NON_CANONICAL: Readonly<Record<string, string>> = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, 'fixtures/non-canonical.json'), 'utf8'),
)
