import type { ConceptSet } from '@data-dictionary/format'
import { contentEqual, expressionChange } from './diff'

export type BumpType = 'major' | 'minor' | 'patch'

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

/** `[major, minor, patch]` of an `X.Y.Z` version, null for anything else. */
export function parseVersion(version: string): [number, number, number] | null {
  const m = SEMVER.exec(version.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

export function isValidVersion(version: string): boolean {
  return parseVersion(version) !== null
}

/** The next version of that type (lower parts reset); an unparsable version counts as `1.0.0`. */
export function bumpVersion(version: string, type: BumpType): string {
  const [major, minor, patch] = parseVersion(version) ?? [1, 0, 0]
  if (type === 'major') return `${major + 1}.0.0`
  if (type === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

/** Negative when a < b, 0 when equal, positive when a > b; unparsable versions sort first. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return (pa ? 1 : 0) - (pb ? 1 : 0)
  return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2]
}

/**
 * The bump an edit calls for: `major` when it can drop concepts from the
 * resolved list (a study citing the old version would lose codes), `minor`
 * when it only adds some, `patch` for everything else (texts, status,
 * statistics). The author decides; this is the default offered.
 */
export function suggestBump(base: ConceptSet, next: ConceptSet): BumpType {
  if (contentEqual(base.expression, next.expression)) return 'patch'
  const change = expressionChange(base, next)
  if (change.narrows) return 'major'
  if (change.broadens) return 'minor'
  return 'patch'
}

/**
 * Why `version` can't be the new version of a set now at `current`: invalid,
 * not above the current one, or already published (a `(id, version)` pair is
 * never reused). Null when it can.
 */
export function newVersionProblem(
  version: string,
  current: string,
  published: Iterable<string>,
): 'invalid' | 'not_greater' | 'taken' | null {
  if (!isValidVersion(version)) return 'invalid'
  for (const v of published) if (v === version.trim()) return 'taken'
  if (isValidVersion(current) && compareVersions(version, current) <= 0) return 'not_greater'
  return null
}
