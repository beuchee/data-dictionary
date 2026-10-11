// Ported from legacy/projects.js (edit mode: groups, add / remove / move concept
// sets, pinned version updates, diffResolved, projectNameTaken, submitModal) as
// pure functions: every operation returns new groups, never mutates its input.
import { DEFAULT_GROUP_ID, DEFAULT_GROUP_RULE, projectGroups } from '@/lib/coverage/groups'
import { cloneContent } from '@/lib/export/provenance'
import type { GroupRule, PinnedConceptSet, Project, ProjectGroup, ResolvedConcept } from '@data-dictionary/format'

/** v1's name of the group a legacy project (or a new one) starts with. */
export const DEFAULT_GROUP_NAMES: Record<string, string> = { en: 'Default', fr: 'Par défaut' }
/** v1's name of an added group. */
export const NEW_GROUP_NAMES: Record<string, string> = { en: 'New group', fr: 'Nouveau groupe' }

function namesFor(languages: readonly string[], names: Record<string, string>): ProjectGroup['translations'] {
  return Object.fromEntries(languages.filter((l) => names[l]).map((l) => [l, { name: names[l] }]))
}

function copyGroup(group: ProjectGroup): ProjectGroup {
  return { ...cloneContent(group), conceptSets: (group.conceptSets ?? []).map((e) => ({ ...e })) }
}

/**
 * A project's groups as an editable copy: a legacy flat project becomes one
 * default group named as v1 named it, a group's legacy field-first `name`
 * becomes language-first `translations`.
 */
export function editableGroups(
  project: Project,
  currentVersion: (id: number) => string | null | undefined,
  languages: readonly string[],
): ProjectGroup[] {
  const groups = projectGroups(project, currentVersion).map(copyGroup)
  for (const g of groups) {
    if (!g.translations) {
      const legacy = g.name
      g.translations =
        typeof legacy === 'string' && legacy
          ? Object.fromEntries(languages.map((l) => [l, { name: legacy }]))
          : legacy && typeof legacy === 'object'
            ? Object.fromEntries(Object.entries(legacy).map(([l, name]) => [l, { name }]))
            : g.id === DEFAULT_GROUP_ID
              ? namesFor(languages, DEFAULT_GROUP_NAMES)
              : {}
      delete g.name
    }
    g.rule ??= DEFAULT_GROUP_RULE
  }
  return groups.length > 0 ? groups : [defaultGroup(languages)]
}

export function defaultGroup(languages: readonly string[]): ProjectGroup {
  return { id: DEFAULT_GROUP_ID, translations: namesFor(languages, DEFAULT_GROUP_NAMES), rule: DEFAULT_GROUP_RULE, conceptSets: [] }
}

/** `group-<n>`, unused in `groups` (v1's `newGroupId`). */
export function newGroupId(groups: readonly ProjectGroup[]): string {
  const taken = new Set(groups.map((g) => g.id))
  let n = groups.length + 1
  while (taken.has(`group-${n}`)) n++
  return `group-${n}`
}

export function addGroup(groups: readonly ProjectGroup[], languages: readonly string[]): ProjectGroup[] {
  return [
    ...groups,
    { id: newGroupId(groups), translations: namesFor(languages, NEW_GROUP_NAMES), rule: DEFAULT_GROUP_RULE, conceptSets: [] },
  ]
}

/** Renames a group; a language left empty is dropped (no fallback on another). */
export function renameGroup(groups: readonly ProjectGroup[], groupId: string, names: Record<string, string>): ProjectGroup[] {
  return groups.map((g) => {
    if (g.id !== groupId) return g
    const translations: NonNullable<ProjectGroup['translations']> = {}
    for (const [lang, name] of Object.entries(names)) if (name.trim()) translations[lang] = { ...(g.translations?.[lang] ?? {}), name: name.trim() }
    return { ...g, translations }
  })
}

export function setGroupRule(groups: readonly ProjectGroup[], groupId: string, rule: GroupRule): ProjectGroup[] {
  return groups.map((g) => (g.id === groupId ? { ...g, rule } : g))
}

/** Moves a group one place up or down; unchanged at either end. */
export function moveGroup(groups: readonly ProjectGroup[], groupId: string, direction: 'up' | 'down'): ProjectGroup[] {
  const i = groups.findIndex((g) => g.id === groupId)
  const j = direction === 'up' ? i - 1 : i + 1
  if (i < 0 || j < 0 || j >= groups.length) return [...groups]
  const out = [...groups]
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}

/**
 * Deletes a group; its concept sets move to the first other group (v1). The
 * last group can't be deleted.
 */
export function deleteGroup(groups: readonly ProjectGroup[], groupId: string): ProjectGroup[] {
  if (groups.length <= 1) return [...groups]
  const doomed = groups.find((g) => g.id === groupId)
  if (!doomed) return [...groups]
  const rest = groups.filter((g) => g.id !== groupId)
  const [first, ...others] = rest
  return [{ ...first, conceptSets: [...(first.conceptSets ?? []), ...(doomed.conceptSets ?? [])] }, ...others]
}

/** The group holding concept set `id`, if any. */
export function groupOf(groups: readonly ProjectGroup[], id: number): ProjectGroup | undefined {
  return groups.find((g) => (g.conceptSets ?? []).some((e) => e.id === id))
}

/** Pins `id` at `version` in `groupId`; no-op when the project already has it (in any group). */
export function addConceptSet(groups: readonly ProjectGroup[], groupId: string, id: number, version: string): ProjectGroup[] {
  if (groupOf(groups, id)) return [...groups]
  return groups.map((g) => (g.id === groupId ? { ...g, conceptSets: [...(g.conceptSets ?? []), { id, version }] } : g))
}

export function removeConceptSets(groups: readonly ProjectGroup[], ids: Iterable<number>): ProjectGroup[] {
  const drop = new Set(ids)
  return groups.map((g) => ({ ...g, conceptSets: (g.conceptSets ?? []).filter((e) => !drop.has(e.id)) }))
}

/** Moves concept sets to `targetGroupId`, appended in their current order, keeping their pins. */
export function moveConceptSets(groups: readonly ProjectGroup[], ids: Iterable<number>, targetGroupId: string): ProjectGroup[] {
  const move = new Set(ids)
  if (!groups.some((g) => g.id === targetGroupId)) return [...groups]
  const moved: PinnedConceptSet[] = []
  const stripped = groups.map((g) => {
    if (g.id === targetGroupId) return g
    const keep: PinnedConceptSet[] = []
    for (const e of g.conceptSets ?? []) (move.has(e.id) ? moved : keep).push(e)
    return { ...g, conceptSets: keep }
  })
  return stripped.map((g) => (g.id === targetGroupId ? { ...g, conceptSets: [...(g.conceptSets ?? []), ...moved] } : g))
}

/** The pins behind the current version: `{id, pinned, current}`, in group order. */
export function outdatedPins(
  groups: readonly ProjectGroup[],
  currentVersion: (id: number) => string | null | undefined,
): { id: number; pinned: string; current: string }[] {
  const out: { id: number; pinned: string; current: string }[] = []
  for (const g of groups) {
    for (const e of g.conceptSets ?? []) {
      const current = currentVersion(e.id)
      if (e.version && current && e.version !== current) out.push({ id: e.id, pinned: e.version, current })
    }
  }
  return out
}

/** Pins every entry of `id` at `version`. */
export function updatePin(groups: readonly ProjectGroup[], id: number, version: string): ProjectGroup[] {
  return groups.map((g) => ({
    ...g,
    conceptSets: (g.conceptSets ?? []).map((e) => (e.id === id ? { ...e, version } : e)),
  }))
}

/**
 * `project` with these groups, in the current schema: the legacy flat
 * `conceptSets` / `conceptSetIds` are dropped, `modifiedDate` stamped.
 */
export function withGroups(project: Project, groups: readonly ProjectGroup[], date: string): Project {
  const out = cloneContent(project)
  delete out.conceptSets
  delete out.conceptSetIds
  out.groups = groups.map((g) => ({ ...g, conceptSets: (g.conceptSets ?? []).map((e) => ({ id: e.id, version: e.version })) }))
  out.modifiedDate = date
  return out
}

/** `project` with `longDescription` set in `lang` (empty = ''), as v1 stored it. */
export function withLongDescription(project: Project, lang: string, markdown: string): Project {
  const out = cloneContent(project)
  const translations = { ...(out.translations ?? {}) }
  translations[lang] = { ...(translations[lang] ?? {}), longDescription: markdown.replace(/\s+$/, '') }
  out.translations = translations
  return out
}

// --- Project details --------------------------------------------------------------

export interface ProjectDetails {
  /** Per language. */
  texts: Record<string, { name: string; shortDescription: string }>
  createdBy: string
}

/**
 * Whether another project already uses `name` in any language (trimmed, case
 * insensitive): two cards with one name could not be told apart (v1).
 */
export function projectNameTaken(projects: readonly Project[], name: string, excludeId: number | null): boolean {
  const needle = name.trim().toLowerCase()
  if (!needle) return false
  return projects.some(
    (p) => p.id !== excludeId && Object.values(p.translations ?? {}).some((t) => (t?.name ?? '').trim().toLowerCase() === needle),
  )
}

/** `project` with the details dialog's values (names, short descriptions, author). */
export function applyProjectDetails(project: Project, details: ProjectDetails, date: string): Project {
  const out = cloneContent(project)
  const translations = { ...(out.translations ?? {}) }
  for (const [lang, v] of Object.entries(details.texts)) {
    const filled = v.name.trim() || v.shortDescription.trim()
    if (!filled && !translations[lang]) continue
    translations[lang] = { ...(translations[lang] ?? {}), name: v.name.trim(), shortDescription: v.shortDescription.trim() }
  }
  out.translations = translations
  out.createdBy = details.createdBy.trim()
  out.modifiedDate = date
  return out
}

/** A new project in v1's shape, with the default group. */
export function newProject(id: number, details: ProjectDetails, languages: readonly string[], date: string): Project {
  const base: Project = { id, translations: {}, createdBy: '', createdDate: date, modifiedDate: date, groups: [defaultGroup(languages)] }
  const out = applyProjectDetails(base, details, date)
  for (const t of Object.values(out.translations)) t.longDescription ??= ''
  // Key order of the repository's projects: id, translations, createdBy, createdDate, modifiedDate, groups.
  return { id: out.id, translations: out.translations, createdBy: out.createdBy, createdDate: date, modifiedDate: date, groups: out.groups }
}

// --- Pinned version update ------------------------------------------------------

export interface ResolvedDiff {
  added: ResolvedConcept[]
  removed: ResolvedConcept[]
  oldCount: number
  newCount: number
}

/**
 * The concepts a pin update adds and removes, between the resolved lists of
 * the pinned and the new version (v1's `diffResolved`). Null when either list
 * is unknown: unknown must not read as "everything added".
 */
export function diffResolved(oldList: readonly ResolvedConcept[] | null, newList: readonly ResolvedConcept[] | null): ResolvedDiff | null {
  if (!oldList || !newList) return null
  const before = new Set(oldList.map((c) => c.conceptId))
  const after = new Set(newList.map((c) => c.conceptId))
  return {
    added: newList.filter((c) => !before.has(c.conceptId)),
    removed: oldList.filter((c) => !after.has(c.conceptId)),
    oldCount: oldList.length,
    newCount: newList.length,
  }
}
