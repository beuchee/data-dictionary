/**
 * The content file kinds of a dictionary repository, where each one lives, and
 * the per-kind on-disk details the serializer needs.
 */

export const FILE_KINDS = [
  'concept-set',
  'concept-set-resolved',
  'project',
  'recommended-units',
  'unit-conversions',
  'mapping-recommendations',
  'config',
  'concept-sets-versions',
  'id-counters',
] as const

export type FileKind = (typeof FILE_KINDS)[number]

/**
 * Whether the canonical bytes end with a newline. Every file does, except the
 * resolved concept sets: `resolve.py` writes them with a bare `json.dump`, and
 * all 366 committed files follow that. Changing it means regenerating them all,
 * in one commit, together with this table (and its Python twin).
 */
export const TRAILING_NEWLINE: Readonly<Record<FileKind, boolean>> = {
  'concept-set': true,
  'concept-set-resolved': false,
  project: true,
  'recommended-units': true,
  'unit-conversions': true,
  'mapping-recommendations': true,
  config: true,
  'concept-sets-versions': true,
  'id-counters': true,
}

const FIXED_PATHS: Readonly<Record<string, FileKind>> = {
  'units/recommended_units.json': 'recommended-units',
  'units/unit_conversions.json': 'unit-conversions',
  'mapping_recommendations/mapping_recommendations.json': 'mapping-recommendations',
  'config.json': 'config',
  'concept_sets_versions.json': 'concept-sets-versions',
  'id_counters.json': 'id-counters',
}

const ID_DIRS: Readonly<Record<string, FileKind>> = {
  concept_sets: 'concept-set',
  concept_sets_resolved: 'concept-set-resolved',
  projects: 'project',
}

/**
 * The kind of a file from its path relative to the repository root
 * (`concept_sets/12.json`, `config.json`…), or null when it is not a content file.
 */
export function kindForPath(relPath: string): FileKind | null {
  const path = relPath.replace(/\\/g, '/').replace(/^\.\//, '')
  if (path in FIXED_PATHS) return FIXED_PATHS[path]
  const m = /^([a-z_]+)\/[1-9][0-9]*\.json$/.exec(path)
  return m && m[1] in ID_DIRS ? ID_DIRS[m[1]] : null
}
