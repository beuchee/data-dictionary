// Coverage of an import, shaped for the page: per-project scores and one row per
// pinned concept set (as v1's Eligibility tab). The scoring is @/lib/coverage.
import { evaluateProject, groupName, projectEntries, projectGroups, type GroupRule, type ProjectCoverage } from '@/lib/coverage'
import { pinKey } from '@/stores/mappings-store'
import type { ConceptSetSummary, Project } from '@/lib/data'

export interface EligibilityRow {
  key: string
  groupName: string | null
  rule: GroupRule
  conceptSetId: number
  /** '' = the current version (legacy projects). */
  version: string
  name: string | null
  resolved: number
  available: boolean
  covered: boolean
}

export type ResolvedIdsMap = Readonly<Record<string, number[] | null | undefined>>


/** Every `{id, version}` the projects pin (legacy `conceptSetIds` at the current version). */
export function pinnedEntries(
  projects: readonly Project[],
  currentVersion: (id: number) => string | null,
): { id: number; version: string }[] {
  const seen = new Map<string, { id: number; version: string }>()
  for (const p of projects) {
    for (const e of projectEntries(p, currentVersion)) seen.set(pinKey(e.id, e.version), { id: e.id, version: e.version })
  }
  return [...seen.values()]
}

export function evaluate(
  project: Project,
  mapped: ReadonlySet<number>,
  resolved: ResolvedIdsMap,
  currentVersion: (id: number) => string | null,
): ProjectCoverage {
  return evaluateProject(project, mapped, {
    resolvedIds: (id, version) => resolved[pinKey(id, version)],
    currentVersion,
  })
}

export function eligibilityRows(
  project: Project,
  coverage: ProjectCoverage,
  summaries: ReadonlyMap<number, ConceptSetSummary>,
  lang: string,
  currentVersion: (id: number) => string | null,
): EligibilityRow[] {
  const groups = projectGroups(project, currentVersion)
  return coverage.groups.flatMap((g, gi) =>
    g.perCS.map((cs, ci) => ({
      key: `${g.id}:${ci}:${cs.id}`,
      groupName: groups[gi] ? groupName(groups[gi], lang) : null,
      rule: g.rule,
      conceptSetId: cs.id,
      version: cs.version ?? '',
      name: summaries.get(cs.id)?.translations[lang]?.name ?? null,
      resolved: cs.total,
      available: cs.available,
      covered: cs.covered,
    })),
  )
}

/** Mapped targets that are in at least one loaded resolved list. */
export function matchedTargets(mapped: ReadonlySet<number>, resolved: ResolvedIdsMap): number {
  const inDictionary = new Set<number>()
  for (const ids of Object.values(resolved)) for (const id of ids ?? []) if (mapped.has(id)) inDictionary.add(id)
  return inDictionary.size
}
