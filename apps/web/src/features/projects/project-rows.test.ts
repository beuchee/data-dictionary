import { describe, expect, it } from 'vitest'
import { conceptSetHref, projectCounts, projectSections, projectTranslation, versionStatus } from './project-rows'
import type { ConceptSetSummary, Project } from '@/lib/data'

function summary(id: number, version: string, en: string | null): ConceptSetSummary {
  return {
    id,
    version,
    uniqueId: null,
    translations: en ? { en: { name: en, category: 'Labs' } } : {},
    reviewStatus: 'approved',
    organization: null,
    itemCount: 1,
    resolvedCount: 1,
    modifiedDate: null,
    modifiedBy: null,
  }
}

const summaries = new Map([
  [1, summary(1, '1.1.0', 'Heart rate')],
  [2, summary(2, '2.0.0', null)],
])

describe('projectSections', () => {
  it('builds one section per group, each set at its pinned version', () => {
    const project: Project = {
      id: 1,
      translations: {},
      groups: [
        { id: 'g1', translations: { en: { name: 'Vitals' } }, rule: 'at_least_one', conceptSets: [{ id: 1, version: '1.0.0' }] },
        { id: 'g2', rule: 'optional', conceptSets: [{ id: 2, version: '2.0.0' }, { id: 9, version: '1.0.0' }] },
      ],
    }
    const [g1, g2] = projectSections(project, summaries, 'en')
    expect(g1).toMatchObject({ id: 'g1', name: 'Vitals', rule: 'at_least_one', isDefault: false })
    expect(g1.rows[0]).toMatchObject({ id: 1, pinnedVersion: '1.0.0', currentVersion: '1.1.0', versionStatus: 'outdated', name: 'Heart rate' })
    expect(g2.name).toBeNull()
    // No English translation: nothing, not another language.
    expect(g2.rows[0]).toMatchObject({ versionStatus: 'up_to_date', name: null })
    // Unknown to the catalog.
    expect(g2.rows[1]).toMatchObject({ id: 9, currentVersion: null, versionStatus: 'up_to_date', reviewStatus: null })
  })

  it('reads a legacy flat project as one default all_required group', () => {
    const project: Project = { id: 2, translations: {}, conceptSets: [{ id: 1, version: '' }] }
    const sections = projectSections(project, summaries, 'en')
    expect(sections).toHaveLength(1)
    expect(sections[0]).toMatchObject({ isDefault: true, rule: 'all_required', name: null })
    expect(sections[0].rows[0].versionStatus).toBe('no_version')
  })

  it('reads conceptSetIds at the current version', () => {
    const project: Project = { id: 3, translations: {}, conceptSetIds: [1] }
    expect(projectSections(project, summaries, 'en')[0].rows[0]).toMatchObject({ pinnedVersion: '1.1.0', versionStatus: 'up_to_date' })
  })
})

describe('project helpers', () => {
  it('counts groups and concept sets, legacy included', () => {
    expect(projectCounts({ id: 1, translations: {}, conceptSets: [{ id: 1, version: '1' }, { id: 2, version: '1' }] })).toEqual({ groups: 1, conceptSets: 2 })
    expect(projectCounts({ id: 1, translations: {}, groups: [] })).toEqual({ groups: 0, conceptSets: 0 })
  })

  it('has no cross-language fallback for project texts', () => {
    expect(projectTranslation({ id: 1, translations: { en: { name: 'A' } } }, 'fr')).toEqual({})
  })

  it('links to the pinned version', () => {
    expect(conceptSetHref(4, '1.0.0')).toBe('/concept-sets/4?version=1.0.0')
    expect(conceptSetHref(4, '')).toBe('/concept-sets/4')
    expect(versionStatus('1.0.0', null)).toBe('up_to_date')
  })
})
