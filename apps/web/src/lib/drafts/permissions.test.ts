import { describe, expect, it } from 'vitest'
import {
  DRAFT_PERMISSIONS,
  allowedSubmitModes,
  canCommit,
  canDraft,
  canEdit,
  commitPermissions,
  proposePermission,
} from './permissions'
import { DRAFT_KINDS } from './types'

const has = (granted: string[]) => (p: string) => granted.includes(p)

// The default roles of apps/api/app/core/permissions.py.
const VIEWER = ['concept-sets:read', 'projects:read', 'mappings:read']
const REVIEWER = [...VIEWER, 'reviews:write']
const EDITOR = [...REVIEWER, 'concept-sets:propose', 'projects:propose', 'mappings:write']
const MAINTAINER = [...EDITOR, 'concept-sets:commit', 'projects:commit', 'units:write', 'branding:write']

describe('draft permissions (as drafts_service.KINDS)', () => {
  it('covers every kind', () => {
    expect(Object.keys(DRAFT_PERMISSIONS).sort()).toEqual([...DRAFT_KINDS].sort())
  })

  it('names the permissions of each kind', () => {
    expect(proposePermission('concept-set')).toBe('concept-sets:propose')
    expect(proposePermission('mapping-recommendations')).toBe('mappings:write')
    expect(proposePermission('unit-conversions')).toBe('units:write')
    expect(proposePermission('config')).toBe('branding:write')
    expect(commitPermissions('project')).toEqual(['projects:commit'])
    // No `units:commit` / `mappings:commit` / `branding:commit` exist: write + concept-sets:commit.
    expect(commitPermissions('recommended-units')).toEqual(['units:write', 'concept-sets:commit'])
    expect(commitPermissions('mapping-recommendations')).toEqual(['mappings:write', 'concept-sets:commit'])
    expect(commitPermissions('config')).toEqual(['branding:write', 'concept-sets:commit'])
  })

  it('needs every commit permission', () => {
    expect(canCommit('mapping-recommendations', has(['mappings:write']))).toBe(false)
    expect(canCommit('mapping-recommendations', has(['concept-sets:commit']))).toBe(false)
    expect(canCommit('mapping-recommendations', has(['mappings:write', 'concept-sets:commit']))).toBe(true)
  })

  it('gives each default role what the server gives it', () => {
    expect(allowedSubmitModes('concept-set', has(VIEWER))).toEqual([])
    expect(allowedSubmitModes('concept-set', has(EDITOR))).toEqual(['proposal'])
    expect(allowedSubmitModes('concept-set', has(MAINTAINER))).toEqual(['proposal', 'commit'])
    expect(allowedSubmitModes('mapping-recommendations', has(EDITOR))).toEqual(['proposal'])
    expect(allowedSubmitModes('mapping-recommendations', has(MAINTAINER))).toEqual(['proposal', 'commit'])
    expect(allowedSubmitModes('unit-conversions', has(EDITOR))).toEqual([])
    expect(allowedSubmitModes('config', has(MAINTAINER))).toEqual(['proposal', 'commit'])
  })

  it('lets a reviewer keep and propose a reviews-only draft, and nothing else', () => {
    expect(canDraft('concept-set', has(REVIEWER))).toBe(true)
    expect(canDraft('project', has(REVIEWER))).toBe(false)
    expect(allowedSubmitModes('concept-set', has(REVIEWER), true)).toEqual(['proposal'])
    expect(allowedSubmitModes('concept-set', has(REVIEWER), false)).toEqual([])
    expect(allowedSubmitModes('project', has(REVIEWER), true)).toEqual([])
    expect(canEdit('concept-set', has(REVIEWER))).toBe(false)
    expect(canEdit('mapping-recommendations', has(['mappings:write']))).toBe(true)
    expect(canEdit('concept-set', has([]))).toBe(false)
  })
})
