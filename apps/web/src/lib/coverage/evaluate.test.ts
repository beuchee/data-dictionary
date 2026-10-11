import { describe, expect, it } from 'vitest'
import { buildMappedSet, evaluateAllProjects, evaluateProject, type CoverageSources, type ProjectCoverage } from './evaluate'
import { GROUP_RULES, groupName, groupRule, projectEntries, projectGroups } from './groups'
import inputs from './__fixtures__/v1/inputs.json'
import goldens from './__fixtures__/v1/results.json'
import { GROUP_RULES as FORMAT_GROUP_RULES, type Project } from '@data-dictionary/format'

// Goldens: v1's own engine run on the real projects plus edge cases, by
// apps/web/scripts/generate-coverage-goldens.mjs. Regenerate with that script.

interface Inputs {
  currentVersions: Record<string, string>
  resolved: Record<string, { total: number; ids: number[] }>
  projects: Project[]
  mappedSets: Record<string, number[]>
}
const fixture = inputs as unknown as Inputs

/**
 * The fixture keeps, per pinned (id, version), the size of the resolved list and
 * the ids some mapped set contains; pad with ids far below any mapped one so the
 * list has its real length.
 */
const lists = new Map<string, number[]>()
let filler = -1_000_000_000
for (const [key, { total, ids }] of Object.entries(fixture.resolved)) {
  const list = [...ids]
  while (list.length < total) list.push(filler--)
  lists.set(key, list)
}

const currentVersion = (id: number) => fixture.currentVersions[String(id)] ?? null
const sources: CoverageSources = {
  currentVersion,
  // As the catalog serves it: no version, or the current one, is the current list.
  resolvedIds: (id, version) => {
    const current = currentVersion(id)
    const key = `${id}@${!version || version === current ? (current ?? '') : version}`
    return lists.get(key) ?? null
  },
}

/** v1's result shape, in its key order. */
function v1Shape(result: ProjectCoverage) {
  return {
    projectId: result.projectId,
    score: result.score,
    eligible: result.eligible,
    groups: result.groups.map((g) => ({
      id: g.id,
      rule: g.rule,
      coveredCount: g.coveredCount,
      total: g.total,
      perCS: g.perCS.map((c) => ({ id: c.id, version: c.version, covered: c.covered, total: c.total })),
      score: g.score,
      satisfied: g.satisfied,
    })),
  }
}

describe('coverage — v1 goldens', () => {
  for (const [name, expected] of Object.entries(goldens)) {
    it(`matches v1 byte for byte with the "${name}" mapping`, () => {
      const actual = evaluateAllProjects(fixture.projects, fixture.mappedSets[name], sources).map(v1Shape)
      expect(JSON.stringify(actual)).toBe(JSON.stringify(expected))
    })
  }

  it('exercises real projects and every synthetic edge case', () => {
    expect(fixture.projects.map((p) => p.id)).toEqual([1, 2, 3, 4, 5, 6, 101, 102, 103, 104, 105, 106])
    const scores = (goldens as Record<string, { score: number }[]>).everyFirst.map((r) => r.score)
    expect(scores.slice(0, 6)).toEqual([100, 100, 100, 100, 100, 100])
  })
})

// --- Edge cases --------------------------------------------------------------

const RESOLVED: Record<string, number[]> = {
  '1@1.0.0': [10, 11],
  '1@2.0.0': [12],
  '2@1.0.0': [20],
  '3@1.0.0': [30, 31, 32],
}
const CURRENT: Record<number, string> = { 1: '2.0.0', 2: '1.0.0', 3: '1.0.0' }
const small: CoverageSources = {
  currentVersion: (id) => CURRENT[id] ?? null,
  resolvedIds: (id, version) => RESOLVED[`${id}@${version || CURRENT[id]}`] ?? null,
}
const pin = (id: number, version: string) => ({ id, version })

function project(groups: Project['groups'], extra: Partial<Project> = {}): Project {
  return { id: 1, translations: {}, groups, ...extra }
}

describe('evaluateProject — edge cases', () => {
  it('honours the pinned version, not the current one', () => {
    const p = project([{ id: 'g', rule: 'all_required', conceptSets: [pin(1, '1.0.0')] }])
    expect(evaluateProject(p, buildMappedSet([12]), small).eligible).toBe(false)
    expect(evaluateProject(p, buildMappedSet([11]), small).eligible).toBe(true)
  })

  it('scores an empty group 1 and satisfied, whatever its rule', () => {
    for (const rule of ['all_required', 'at_least_one', 'optional'] as const) {
      const r = evaluateProject(project([{ id: 'g', rule, conceptSets: [] }]), new Set(), small)
      expect(r.groups[0]).toMatchObject({ score: 1, satisfied: true, total: 0 })
      expect(r).toMatchObject({ score: 100, eligible: true })
    }
  })

  it('scores a project with only optional groups on their mean, always eligible', () => {
    const p = project([
      { id: 'a', rule: 'optional', conceptSets: [pin(2, '1.0.0'), pin(3, '1.0.0')] },
      { id: 'b', rule: 'optional', conceptSets: [pin(1, '2.0.0')] },
    ])
    const r = evaluateProject(p, buildMappedSet([20]), small)
    expect(r.score).toBe(25)
    expect(r.eligible).toBe(true)
  })

  it('leaves optional groups out of the score when others exist', () => {
    const p = project([
      { id: 'req', rule: 'all_required', conceptSets: [pin(2, '1.0.0')] },
      { id: 'opt', rule: 'optional', conceptSets: [pin(3, '1.0.0')] },
    ])
    expect(evaluateProject(p, buildMappedSet([20]), small)).toMatchObject({ score: 100, eligible: true })
  })

  it('counts an unknown set or a missing version as uncovered and unavailable', () => {
    const p = project([
      { id: 'g', rule: 'at_least_one', conceptSets: [pin(99, '1.0.0'), pin(1, '9.9.9')] },
    ])
    const r = evaluateProject(p, buildMappedSet([10, 11, 12]), small)
    expect(r.groups[0].perCS).toEqual([
      { id: 99, version: '1.0.0', covered: false, total: 0, available: false },
      { id: 1, version: '9.9.9', covered: false, total: 0, available: false },
    ])
    expect(r).toMatchObject({ score: 0, eligible: false })
  })

  it('applies at_least_one as 0 or 1', () => {
    const p = project([{ id: 'g', rule: 'at_least_one', conceptSets: [pin(2, '1.0.0'), pin(3, '1.0.0')] }])
    expect(evaluateProject(p, buildMappedSet([31]), small).groups[0]).toMatchObject({ score: 1, coveredCount: 1 })
  })

  it('defaults a missing rule to all_required', () => {
    const p = project([{ id: 'g', conceptSets: [pin(2, '1.0.0'), pin(3, '1.0.0')] } as never])
    const r = evaluateProject(p, buildMappedSet([20]), small)
    expect(r.groups[0]).toMatchObject({ rule: 'all_required', score: 0.5, satisfied: false })
    expect(r.score).toBe(50)
  })

  it('scores a project without groups 100 and eligible', () => {
    expect(evaluateProject(project([]), new Set(), small)).toMatchObject({ score: 100, eligible: true })
  })

  it('ignores 0 and non-integers in the mapping', () => {
    expect([...buildMappedSet([0, 1.5, 7, 7, -3])]).toEqual([7, -3])
  })
})

describe('project groups', () => {
  it('reads a legacy flat list as one all_required group', () => {
    const p: Project = { id: 2, translations: {}, conceptSets: [pin(1, '1.0.0')] }
    expect(projectGroups(p)).toEqual([{ id: 'group-default', rule: 'all_required', conceptSets: [pin(1, '1.0.0')] }])
  })

  it('reads conceptSetIds at their current version', () => {
    const p: Project = { id: 3, translations: {}, conceptSetIds: [1, 42] }
    expect(projectEntries(p, small.currentVersion)).toEqual([pin(1, '2.0.0'), pin(42, '')])
  })

  it('names a group in one language, without fallback', () => {
    const g = { id: 'g', rule: 'optional' as const, conceptSets: [], translations: { en: { name: 'Vitals' } } }
    expect(groupName(g, 'en')).toBe('Vitals')
    expect(groupName(g, 'fr')).toBeNull()
    expect(groupName({ id: 'h', rule: 'optional', conceptSets: [], name: { fr: 'Signes' } }, 'fr')).toBe('Signes')
  })

  it('restates the format package rules', () => {
    expect(GROUP_RULES).toEqual(FORMAT_GROUP_RULES)
  })

  it('reads an unknown rule as all_required', () => {
    expect(groupRule({ rule: 'whatever' as never })).toBe('all_required')
  })
})
