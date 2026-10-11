// Ported from v1 legacy/app.js (getProjectGroups, getProjectConceptSetEntries, GROUP_RULES).
import type { GroupRule, PinnedConceptSet, Project, ProjectGroup } from '@data-dictionary/format'

export type { GroupRule }

/**
 * The format package's `GROUP_RULES`, restated: importing a value from that
 * package would bundle its validator (ajv) into the page. A test keeps them equal.
 */
export const GROUP_RULES: readonly GroupRule[] = ['all_required', 'at_least_one', 'optional']

/** The rule of a group that names none (and of the group a legacy project is read as). */
export const DEFAULT_GROUP_RULE: GroupRule = 'all_required'

/** Id of the synthetic group a legacy flat project is read as (same as v1). */
export const DEFAULT_GROUP_ID = 'group-default'

/** The current version of a concept set, or null when the catalog has no such set. */
export type CurrentVersionLookup = (id: number) => string | null | undefined

/**
 * A project's groups, whatever its shape: `groups[]` as is; a legacy flat
 * `conceptSets` list, or the oldest `conceptSetIds` (read at their current
 * version), as one `all_required` group with `DEFAULT_GROUP_ID` and no name.
 */
export function projectGroups(project: Project, currentVersion: CurrentVersionLookup = () => null): ProjectGroup[] {
  if (Array.isArray(project.groups)) return project.groups
  let entries: PinnedConceptSet[] = []
  if (Array.isArray(project.conceptSets)) entries = project.conceptSets.slice()
  else if (Array.isArray(project.conceptSetIds)) {
    entries = project.conceptSetIds.map((id) => ({ id, version: currentVersion(id) ?? '' }))
  }
  return [{ id: DEFAULT_GROUP_ID, rule: DEFAULT_GROUP_RULE, conceptSets: entries }]
}

/** Every `{id, version}` a project pins, in group order. */
export function projectEntries(project: Project, currentVersion?: CurrentVersionLookup): PinnedConceptSet[] {
  return projectGroups(project, currentVersion).flatMap((g) => g.conceptSets ?? [])
}

/**
 * A group's rule; `all_required` when missing (as v1). An unknown value is read as
 * `all_required` too, where v1 scored it like `optional` yet still counted it in
 * the project score.
 */
export function groupRule(group: Pick<ProjectGroup, 'rule'>): GroupRule {
  return GROUP_RULES.includes(group.rule) ? group.rule : DEFAULT_GROUP_RULE
}

/**
 * A group's name in `lang`, with no cross-language fallback; reads the legacy
 * field-first `name` too. Null when the group has none in that language.
 */
export function groupName(group: ProjectGroup, lang: string): string | null {
  const translated = group.translations?.[lang]?.name
  if (translated) return translated
  if (group.name && typeof group.name === 'object') return group.name[lang] || null
  if (typeof group.name === 'string' && group.name) return group.name
  return null
}
