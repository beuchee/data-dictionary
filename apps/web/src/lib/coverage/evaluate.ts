// Ported from v1 legacy/mapping.js (buildMappedSet, evaluateProject, evaluateAllProjects).
import { groupRule, projectGroups, type CurrentVersionLookup, type GroupRule } from './groups'
import type { Project } from '@data-dictionary/format'

/**
 * The resolved concept ids of a concept set at a version (`undefined` or `''` =
 * its current one), or null when that list is not available: unknown set, or a
 * version that was never snapshotted.
 */
export type ResolvedIdsLookup = (id: number, version: string | undefined) => readonly number[] | null | undefined

export interface CoverageSources {
  resolvedIds: ResolvedIdsLookup
  /** Needed only for the oldest legacy projects (`conceptSetIds`, read at the current version). */
  currentVersion?: CurrentVersionLookup
}

export interface ConceptSetCoverage {
  id: number
  version: string
  /** At least one of its resolved concepts is mapped. */
  covered: boolean
  /** Size of its resolved list; 0 when unavailable. */
  total: number
  /** False when no resolved list was found (unknown set, version never snapshotted). */
  available: boolean
}

export interface GroupCoverage {
  id: string
  rule: GroupRule
  coveredCount: number
  total: number
  perCS: ConceptSetCoverage[]
  /** 0..1 */
  score: number
  satisfied: boolean
}

export interface ProjectCoverage {
  projectId: number
  groups: GroupCoverage[]
  /** Percentage, rounded: the mean score of the non-optional groups (of all groups when every one is optional). */
  score: number
  /** Every scored group is satisfied. */
  eligible: boolean
}

/** The set of mapped (target) concept ids; 0 and non-integers are not mappings. */
export function buildMappedSet(conceptIds: Iterable<number>): Set<number> {
  const set = new Set<number>()
  for (const id of conceptIds) if (Number.isInteger(id) && id !== 0) set.add(id)
  return set
}

function scoreGroup(rule: GroupRule, coveredCount: number, total: number): { score: number; satisfied: boolean } {
  if (total === 0) return { score: 1, satisfied: true }
  switch (rule) {
    case 'all_required':
      return { score: coveredCount / total, satisfied: coveredCount === total }
    case 'at_least_one':
      return { score: coveredCount > 0 ? 1 : 0, satisfied: coveredCount > 0 }
    case 'optional':
      return { score: coveredCount / total, satisfied: true }
  }
}

/**
 * How well a mapping covers a project. A concept set is covered when any of its
 * resolved concepts at the PINNED version is mapped; a group is scored and
 * satisfied by its rule (`all_required`: covered / n, satisfied when all are;
 * `at_least_one`: 0 or 1; `optional`: covered / n, always satisfied; an empty
 * group: 1, satisfied); the project scores the mean of its non-optional groups
 * and is eligible when all of them are satisfied.
 */
export function evaluateProject(project: Project, mapped: ReadonlySet<number>, sources: CoverageSources): ProjectCoverage {
  const groups = projectGroups(project, sources.currentVersion).map((g): GroupCoverage => {
    const entries = g.conceptSets ?? []
    let coveredCount = 0
    const perCS = entries.map((e): ConceptSetCoverage => {
      const resolved = sources.resolvedIds(e.id, e.version)
      const ids = resolved ?? []
      const covered = ids.some((id) => mapped.has(id))
      if (covered) coveredCount++
      return { id: e.id, version: e.version, covered, total: ids.length, available: resolved != null }
    })
    const rule = groupRule(g)
    return { id: g.id, rule, coveredCount, total: entries.length, perCS, ...scoreGroup(rule, coveredCount, entries.length) }
  })

  const nonOptional = groups.filter((g) => g.rule !== 'optional')
  const scored = nonOptional.length > 0 ? nonOptional : groups
  const mean = scored.length > 0 ? scored.reduce((sum, g) => sum + g.score, 0) / scored.length : 1
  return {
    projectId: project.id,
    groups,
    score: Math.round(mean * 100),
    eligible: scored.every((g) => g.satisfied),
  }
}

/** `evaluateProject` for every project, against one mapping. */
export function evaluateAllProjects(
  projects: readonly Project[],
  mappedConceptIds: Iterable<number>,
  sources: CoverageSources,
): ProjectCoverage[] {
  const mapped = buildMappedSet(mappedConceptIds)
  return projects.map((p) => evaluateProject(p, mapped, sources))
}
