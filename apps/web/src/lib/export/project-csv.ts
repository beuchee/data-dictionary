// Ported from legacy/projects.js (csvField, exportProjectCSV) and legacy/app.js
// (getProjectGroups, getGroupName, t, tProj); byte-identical to v1 (project-csv.test.ts).
import type { ConceptSet, PinnedConceptSet, Project, ProjectGroup } from '@data-dictionary/format'

/**
 * The concept set a project pins. `version` is the pinned one; empty or absent
 * means the current version (legacy `conceptSetIds` projects). null when unknown:
 * the set is then left out of the export, as v1 did.
 */
export type PinnedConceptSetLookup = (id: number, version: string | undefined) => ConceptSet | null | undefined

/**
 * A project's groups. Legacy projects (flat `conceptSets`, or bare
 * `conceptSetIds` read at their current version) become one "Default" group
 * with rule `all_required`.
 */
export function projectGroups(project: Project): ProjectGroup[] {
  if (Array.isArray(project.groups)) return project.groups
  let entries: PinnedConceptSet[] = []
  if (Array.isArray(project.conceptSets)) entries = project.conceptSets.slice()
  else if (Array.isArray(project.conceptSetIds)) entries = project.conceptSetIds.map((id) => ({ id, version: '' }))
  return [{
    id: 'group-default',
    translations: { en: { name: 'Default' }, fr: { name: 'Par défaut' } },
    rule: 'all_required',
    conceptSets: entries,
  }]
}

/** Every `{id, version}` a project pins, in group order (what to preload before an export). */
export function pinnedConceptSets(project: Project): PinnedConceptSet[] {
  return projectGroups(project).flatMap((g) => g.conceptSets ?? [])
}

/**
 * A group's name in `lang`, else English, else French (v1's fallbacks, kept for
 * export parity), reading the legacy field-first `name` too.
 */
export function groupName(group: ProjectGroup, lang: string): string {
  const tr = group.translations
  if (tr) return tr[lang]?.name || tr.en?.name || tr.fr?.name || ''
  if (group.name && typeof group.name === 'object') return group.name[lang] || group.name.en || group.name.fr || ''
  return (group.name as string | undefined) || ''
}

/**
 * One quoted CSV cell, embedded quotes doubled. A text starting with `=`, `+`,
 * `-` or `@` gets a leading `'` so a spreadsheet does not run it as a formula;
 * plain numbers stay as they are.
 */
export function csvField(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value)
  if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s
  return '"' + s.replace(/"/g, '""') + '"'
}

export const PROJECT_CSV_HEADER = ['group_name', 'group_rule',
  'concept_set_id', 'concept_set_name', 'concept_set_category', 'concept_set_subcategory',
  'concept_id', 'concept_name', 'domain_id', 'vocabulary_id', 'concept_class_id', 'concept_code',
  'standard_concept', 'invalid_reason', 'valid_start_date', 'valid_end_date',
  'is_excluded', 'include_descendants', 'include_mapped'] as const

/** Translation of a set or project in `lang`, else English (v1's `App.t` / `App.tProj`). */
function translation<T>(tr: Record<string, T> | undefined | null, lang: string): Partial<T> {
  return (tr && (tr[lang] || tr.en)) || {}
}

/**
 * One row per expression item of every concept set the project pins, at its
 * pinned version, prefixed with a UTF-8 BOM so Excel reads accents right.
 * Concept sets `lookup` does not know are skipped.
 */
export function buildProjectCsv(project: Project, lookup: PinnedConceptSetLookup, lang: string): string {
  const rows: string[] = [PROJECT_CSV_HEADER.join(',')]
  for (const g of projectGroups(project)) {
    const name = groupName(g, lang)
    const rule = g.rule || ''
    for (const e of g.conceptSets ?? []) {
      const cs = lookup(e.id, e.version || undefined)
      if (!cs) continue
      const tr = translation(cs.metadata?.translations, lang)
      for (const item of cs.expression?.items ?? []) {
        const c = item.concept
        rows.push([
          csvField(name),
          csvField(rule),
          csvId(cs.id),
          csvField(tr.name || cs.name || ''),
          csvField(tr.category || ''),
          csvField(tr.subcategory || ''),
          csvId(c.conceptId),
          csvField(c.conceptName || ''),
          csvField(c.domainId || ''),
          csvField(c.vocabularyId || ''),
          csvField(c.conceptClassId || ''),
          csvField(c.conceptCode || ''),
          csvField(c.standardConcept || ''),
          csvField(c.invalidReason || ''),
          csvField(c.validStartDate || ''),
          csvField(c.validEndDate || ''),
          item.isExcluded ? 'TRUE' : 'FALSE',
          item.includeDescendants ? 'TRUE' : 'FALSE',
          item.includeMapped ? 'TRUE' : 'FALSE',
        ].join(','))
      }
    }
  }
  return '\uFEFF' + rows.join('\n')
}

/** Ids are written bare, as v1 did; anything but a number is quoted like text. */
function csvId(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : csvField(value)
}

/** `<project name>_concepts.csv`, every character outside [A-Za-z0-9] replaced by `_`. */
export function projectCsvFilename(project: Project, lang: string): string {
  const name = translation(project.translations, lang).name || 'project'
  return name.replace(/[^a-zA-Z0-9]/g, '_') + '_concepts.csv'
}
