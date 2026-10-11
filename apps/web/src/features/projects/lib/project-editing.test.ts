import { describe, expect, it } from 'vitest'
import { validate, type Project, type ProjectGroup, type ResolvedConcept } from '@data-dictionary/format'
import * as v1 from '@/lib/export/v1-fixtures'
import {
  addConceptSet,
  addGroup,
  applyProjectDetails,
  deleteGroup,
  diffResolved,
  editableGroups,
  moveConceptSets,
  moveGroup,
  newGroupId,
  newProject,
  outdatedPins,
  projectNameTaken,
  removeConceptSets,
  renameGroup,
  setGroupRule,
  updatePin,
  withGroups,
  withLongDescription,
} from './project-editing'

const langs = ['en', 'fr']
const g = (id: string, ids: number[], version = '1.0.0'): ProjectGroup => ({
  id,
  translations: { en: { name: id } },
  rule: 'all_required',
  conceptSets: ids.map((i) => ({ id: i, version })),
})
const ids = (groups: ProjectGroup[]) => groups.map((x) => [x.id, (x.conceptSets ?? []).map((e) => e.id)])

describe('editableGroups', () => {
  it('reads a legacy flat project as the default group, named as v1', () => {
    const legacy: Project = { id: 1, translations: {}, conceptSets: [{ id: 3, version: '1.0.0' }] }
    expect(editableGroups(legacy, () => null, langs)).toEqual([
      { id: 'group-default', rule: 'all_required', translations: { en: { name: 'Default' }, fr: { name: 'Par défaut' } }, conceptSets: [{ id: 3, version: '1.0.0' }] },
    ])
  })

  it('pins bare conceptSetIds at their current version', () => {
    const oldest: Project = { id: 1, translations: {}, conceptSetIds: [7] }
    expect(editableGroups(oldest, () => '2.0.0', langs)[0].conceptSets).toEqual([{ id: 7, version: '2.0.0' }])
  })

  it('turns a field-first group name language-first, and copies', () => {
    const project: Project = { id: 1, translations: {}, groups: [{ id: 'a', name: { en: 'Labs', fr: 'Labo' }, rule: 'optional', conceptSets: [] }] }
    const groups = editableGroups(project, () => null, langs)
    expect(groups[0]).toEqual({ id: 'a', translations: { en: { name: 'Labs' }, fr: { name: 'Labo' } }, rule: 'optional', conceptSets: [] })
    groups[0].conceptSets.push({ id: 1, version: '1' })
    expect(project.groups?.[0].conceptSets).toEqual([])
  })

  it('gives an empty project one group', () => {
    expect(editableGroups({ id: 1, translations: {}, groups: [] }, () => null, ['fr'])[0].translations).toEqual({ fr: { name: 'Par défaut' } })
  })
})

describe('group operations', () => {
  const groups = [g('group-1', [1, 2]), g('group-2', [3])]

  it('adds groups with unused ids', () => {
    expect(newGroupId([g('group-3', []), g('group-1', [])])).toBe('group-4')
    const added = addGroup(groups, langs)
    expect(added.at(-1)).toMatchObject({ id: 'group-3', translations: { en: { name: 'New group' }, fr: { name: 'Nouveau groupe' } }, conceptSets: [] })
    expect(groups).toHaveLength(2)
  })

  it('renames per language, dropping empty languages', () => {
    expect(renameGroup(groups, 'group-1', { en: ' Labs ', fr: '' })[0].translations).toEqual({ en: { name: 'Labs' } })
  })

  it('sets rules and reorders, unchanged at the ends', () => {
    expect(setGroupRule(groups, 'group-2', 'optional')[1].rule).toBe('optional')
    expect(ids(moveGroup(groups, 'group-2', 'up'))).toEqual([['group-2', [3]], ['group-1', [1, 2]]])
    expect(ids(moveGroup(groups, 'group-1', 'up'))).toEqual(ids(groups))
    expect(ids(moveGroup(groups, 'group-2', 'down'))).toEqual(ids(groups))
  })

  it('deletes a group, moving its sets to the first other one, never the last group', () => {
    expect(ids(deleteGroup(groups, 'group-1'))).toEqual([['group-2', [3, 1, 2]]])
    expect(ids(deleteGroup([g('only', [1])], 'only'))).toEqual([['only', [1]]])
  })
})

describe('concept set operations', () => {
  const groups = [g('a', [1, 2]), g('b', [3])]

  it('adds a set once across the project', () => {
    expect(ids(addConceptSet(groups, 'b', 4, '1.2.0'))).toEqual([['a', [1, 2]], ['b', [3, 4]]])
    expect(addConceptSet(groups, 'b', 4, '1.2.0')[1].conceptSets?.at(-1)).toEqual({ id: 4, version: '1.2.0' })
    expect(ids(addConceptSet(groups, 'b', 1, '9.0.0'))).toEqual(ids(groups))
  })

  it('removes and moves, keeping pins and order', () => {
    expect(ids(removeConceptSets(groups, [2, 3]))).toEqual([['a', [1]], ['b', []]])
    const moved = moveConceptSets(groups, [1, 3], 'b')
    expect(ids(moved)).toEqual([['a', [2]], ['b', [3, 1]]])
    expect(moved[1].conceptSets?.[1]).toEqual({ id: 1, version: '1.0.0' })
    expect(ids(moveConceptSets(groups, [1], 'missing'))).toEqual(ids(groups))
  })
})

describe('pinned versions', () => {
  const groups = [g('a', [1, 2], '1.0.0'), { ...g('b', [3]), conceptSets: [{ id: 3, version: '' }] }]
  const current = (id: number) => ({ 1: '1.1.0', 2: '1.0.0', 3: '2.0.0' })[id] ?? null

  it('lists the outdated pins, ignoring unpinned and unknown sets', () => {
    expect(outdatedPins(groups, current)).toEqual([{ id: 1, pinned: '1.0.0', current: '1.1.0' }])
    expect(outdatedPins([g('x', [99])], current)).toEqual([])
  })

  it('updates a pin', () => {
    expect(updatePin(groups, 1, '1.1.0')[0].conceptSets?.[0]).toEqual({ id: 1, version: '1.1.0' })
  })

  it('diffs the resolved lists, unknown when either is missing', () => {
    const c = (conceptId: number) => ({ conceptId }) as ResolvedConcept
    const diff = diffResolved([c(1), c(2)], [c(2), c(3), c(4)])
    expect(diff).toMatchObject({ oldCount: 2, newCount: 3 })
    expect(diff?.added.map((x) => x.conceptId)).toEqual([3, 4])
    expect(diff?.removed.map((x) => x.conceptId)).toEqual([1])
    expect(diffResolved(null, [c(1)])).toBeNull()
    expect(diffResolved([], [])).toEqual({ added: [], removed: [], oldCount: 0, newCount: 0 })
  })
})

describe('project files', () => {
  it('canonicalizes a legacy project on save', () => {
    const legacy: Project = { id: 1, translations: {}, conceptSets: [{ id: 3, version: '1.0.0' }], conceptSetIds: [3] }
    const out = withGroups(legacy, editableGroups(legacy, () => null, langs), '2026-10-11')
    expect('conceptSets' in out).toBe(false)
    expect('conceptSetIds' in out).toBe(false)
    expect(out.modifiedDate).toBe('2026-10-11')
    expect(validate('project', out).valid).toBe(true)
  })

  it('keeps a real project valid through its edits', () => {
    const p = v1.project(1)
    const groups = addGroup(editableGroups(p, () => null, langs), langs)
    const out = withLongDescription(withGroups(p, groups, '2026-10-11'), 'fr', '# Titre\n')
    expect(out.translations.fr.longDescription).toBe('# Titre')
    expect(validate('project', out).valid).toBe(true)
  })

  it('creates a project with the default group, in the repository key order', () => {
    const p = newProject(7, { texts: { en: { name: 'Sepsis', shortDescription: 'Early sepsis' }, fr: { name: '', shortDescription: '' } }, createdBy: 'Ada' }, langs, '2026-10-11')
    expect(Object.keys(p)).toEqual(['id', 'translations', 'createdBy', 'createdDate', 'modifiedDate', 'groups'])
    expect(p.translations).toEqual({ en: { name: 'Sepsis', shortDescription: 'Early sepsis', longDescription: '' } })
    expect(p.groups?.[0].id).toBe('group-default')
    expect(validate('project', p).valid).toBe(true)
  })

  it('edits details and detects name clashes in any language', () => {
    const projects: Project[] = [{ id: 1, translations: { en: { name: 'Sepsis' }, fr: { name: 'Sepsis FR' } } }, { id: 2, translations: {} }]
    expect(projectNameTaken(projects, ' sepsis fr ', null)).toBe(true)
    expect(projectNameTaken(projects, 'Sepsis', 1)).toBe(false)
    expect(projectNameTaken(projects, '', null)).toBe(false)
    const edited = applyProjectDetails(projects[0], { texts: { en: { name: 'Shock', shortDescription: '' } }, createdBy: ' Bo ' }, '2026-10-11')
    expect(edited).toMatchObject({ createdBy: 'Bo', modifiedDate: '2026-10-11', translations: { en: { name: 'Shock' }, fr: { name: 'Sepsis FR' } } })
  })
})
