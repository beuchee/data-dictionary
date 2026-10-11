import { describe, expect, it } from 'vitest'
import { conceptSetSummary } from '@/lib/data/catalog'
import * as v1 from '@/lib/export/v1-fixtures'
import { findDraft, nextLocalId, overlayConceptSetSummaries, overlayProjects } from './overlay'
import { draftEntityId, draftFilePath, isNewDraft } from './paths'
import type { Draft } from './types'

const at = '2026-10-11T00:00:00.000Z'
const summaries = [1, 2, 10].map((id) => conceptSetSummary({ ...v1.conceptSet(1), id }, 5))

function csDraft(id: string, targetId: number | null, contentId: number, name: string): Draft {
  const cs = v1.conceptSet(1)
  return {
    id,
    kind: 'concept-set',
    targetId,
    baseCommit: null,
    createdAt: at,
    updatedAt: at,
    content: { ...cs, id: contentId, metadata: { ...cs.metadata, translations: { en: { name } } } },
  }
}

describe('overlayConceptSetSummaries', () => {
  it('shows an edited set from its draft, keeping the catalog resolved count', () => {
    const { items, draftIds, newIds } = overlayConceptSetSummaries(summaries, [csDraft('a', 2, 2, 'Edited')])
    expect(items.map((s) => s.id)).toEqual([1, 2, 10])
    expect(items[1].translations.en.name).toBe('Edited')
    expect(items[1].resolvedCount).toBe(5)
    expect([...draftIds]).toEqual([2])
    expect(newIds.size).toBe(0)
  })

  it('adds new sets in id order, with no resolved list', () => {
    const { items, newIds } = overlayConceptSetSummaries(summaries, [csDraft('b', null, 5, 'New')])
    expect(items.map((s) => s.id)).toEqual([1, 2, 5, 10])
    expect(items[2].resolvedCount).toBeNull()
    expect([...newIds]).toEqual([5])
  })

  it('hides locally deleted sets, unless a draft brings one back', () => {
    expect(overlayConceptSetSummaries(summaries, [], [1, 10]).items.map((s) => s.id)).toEqual([2])
    expect(overlayConceptSetSummaries(summaries, [csDraft('a', 1, 1, 'Back')], [1]).items.map((s) => s.id)).toEqual([1, 2, 10])
  })

  it('ignores drafts of other kinds', () => {
    const project: Draft = { id: 'p', kind: 'project', targetId: 2, baseCommit: null, createdAt: at, updatedAt: at, content: v1.project(1) }
    expect(overlayConceptSetSummaries(summaries, [project]).draftIds.size).toBe(0)
  })
})

describe('overlayProjects and findDraft', () => {
  it('replaces, adds and hides projects', () => {
    const p1 = { ...v1.project(1), id: 1 }
    const p2 = { ...v1.project(1), id: 2 }
    const edited: Draft = { id: 'e', kind: 'project', targetId: 2, baseCommit: null, createdAt: at, updatedAt: at, content: { ...p2, createdBy: 'X' } }
    const created: Draft = { id: 'n', kind: 'project', targetId: null, baseCommit: null, createdAt: at, updatedAt: at, content: { ...p1, id: 9 } }
    const { items, newIds } = overlayProjects([p1, p2], [edited, created], [1])
    expect(items.map((p) => [p.id, p.createdBy])).toEqual([[2, 'X'], [9, p1.createdBy]])
    expect([...newIds]).toEqual([9])
    expect(findDraft([edited, created], 'project', 9)?.id).toBe('n')
    expect(findDraft([edited, created], 'concept-set', 2)).toBeUndefined()
  })
})

describe('paths', () => {
  it('maps drafts to their files and ids', () => {
    const created = csDraft('b', null, 401, 'New')
    expect(isNewDraft(created)).toBe(true)
    expect(draftEntityId(created)).toBe(401)
    expect(draftFilePath('concept-set', 401)).toBe('concept_sets/401.json')
    expect(draftFilePath('project', 3)).toBe('projects/3.json')
    expect(draftFilePath('mapping-recommendations', null)).toBe('mapping_recommendations/mapping_recommendations.json')
    const mapping: Draft = { id: 'm', kind: 'mapping-recommendations', targetId: null, baseCommit: null, createdAt: at, updatedAt: at, content: { translations: {} } }
    expect(isNewDraft(mapping)).toBe(false)
    expect(draftEntityId(mapping)).toBeNull()
  })
})

describe('nextLocalId', () => {
  it('stays above ids in use, the repo counter and the local counter', () => {
    expect(nextLocalId([1, 5, 3], null, 0)).toBe(6)
    expect(nextLocalId([1, 5, 3], 20, 0)).toBe(20)
    expect(nextLocalId([1, 5, 3], 20, 25)).toBe(25)
    expect(nextLocalId([], undefined, 0)).toBe(1)
  })
})
