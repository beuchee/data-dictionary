import { groupName, groupRule, projectGroups, type GroupRule } from '@/lib/coverage'
import type { ConceptSetSummary, Project } from '@/lib/data'
import type { ProjectTranslation, ReviewStatus } from '@data-dictionary/format'

/** A project's texts in `lang`; empty when it has none (no cross-language fallback). */
export function projectTranslation(project: Project, lang: string): ProjectTranslation {
  return project.translations?.[lang] ?? {}
}

export type VersionStatus = 'outdated' | 'up_to_date' | 'no_version'

export interface ProjectConceptSetRow {
  /** Unique within the project: a set may sit in two groups. */
  key: string
  id: number
  pinnedVersion: string
  /** null when the catalog has no such concept set. */
  currentVersion: string | null
  versionStatus: VersionStatus
  /** Texts of the current version in `lang` (as v1); null when unknown or untranslated. */
  name: string | null
  category: string | null
  subcategory: string | null
  shortDescription: string | null
  reviewStatus: ReviewStatus | null
}

export interface ProjectGroupSection {
  id: string
  /** null when the group has no name in `lang`. */
  name: string | null
  /** The synthetic group of a legacy flat project. */
  isDefault: boolean
  rule: GroupRule
  rows: ProjectConceptSetRow[]
}

export function versionStatus(pinned: string, current: string | null): VersionStatus {
  if (!pinned) return 'no_version'
  return current && pinned !== current ? 'outdated' : 'up_to_date'
}

/**
 * The concept set table of a project, one section per group, each set at its
 * pinned version next to the catalog's current one. Legacy projects (flat
 * `conceptSets`, `conceptSetIds`) read as one default group.
 */
export function projectSections(
  project: Project,
  summaries: ReadonlyMap<number, ConceptSetSummary>,
  lang: string,
): ProjectGroupSection[] {
  const currentVersion = (id: number) => summaries.get(id)?.version ?? null
  return projectGroups(project, currentVersion).map((group) => ({
    id: group.id,
    name: groupName(group, lang),
    isDefault: !Array.isArray(project.groups),
    rule: groupRule(group),
    rows: (group.conceptSets ?? []).map((entry, index) => {
      const summary = summaries.get(entry.id)
      const tr = summary?.translations[lang]
      const pinned = entry.version ?? ''
      const current = summary?.version ?? null
      return {
        key: `${group.id}:${entry.id}:${index}`,
        id: entry.id,
        pinnedVersion: pinned,
        currentVersion: current,
        versionStatus: versionStatus(pinned, current),
        name: tr?.name ?? null,
        category: tr?.category ?? null,
        subcategory: tr?.subcategory ?? null,
        shortDescription: tr?.shortDescription ?? null,
        reviewStatus: summary?.reviewStatus ?? null,
      }
    }),
  }))
}

/** Counts shown on a project card. */
export function projectCounts(project: Project): { groups: number; conceptSets: number } {
  const groups = projectGroups(project)
  return { groups: groups.length, conceptSets: groups.reduce((n, g) => n + (g.conceptSets?.length ?? 0), 0) }
}

/** The concept set page at a project's pinned version. */
export function conceptSetHref(id: number, pinnedVersion: string): string {
  return pinnedVersion ? `/concept-sets/${id}?version=${encodeURIComponent(pinnedVersion)}` : `/concept-sets/${id}`
}
