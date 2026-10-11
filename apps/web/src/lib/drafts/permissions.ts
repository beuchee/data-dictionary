import type { DraftKind, SubmitMode } from './types'

/**
 * The permissions of each draft kind, as the server checks them
 * (`apps/api/app/services/drafts_service.py` `KINDS`, contract in
 * docs/design/drafts-and-proposals.md). The one place the web app reads them.
 *
 * - `propose`: keep a draft and submit it as a PR / MR.
 * - `commit`: every permission a direct commit needs. The instance-wide files
 *   have no `:commit` of their own: their write permission plus
 *   `concept-sets:commit` (maintainers).
 */
export const DRAFT_PERMISSIONS: Record<DraftKind, { propose: string; commit: readonly string[] }> = {
  'concept-set': { propose: 'concept-sets:propose', commit: ['concept-sets:commit'] },
  project: { propose: 'projects:propose', commit: ['projects:commit'] },
  'recommended-units': { propose: 'units:write', commit: ['units:write', 'concept-sets:commit'] },
  'unit-conversions': { propose: 'units:write', commit: ['units:write', 'concept-sets:commit'] },
  'mapping-recommendations': { propose: 'mappings:write', commit: ['mappings:write', 'concept-sets:commit'] },
  config: { propose: 'branding:write', commit: ['branding:write', 'concept-sets:commit'] },
}

/** Pulling the content working copy (`POST /git/pull`): maintainers. */
export const PULL_PERMISSION = 'concept-sets:commit'

/** The permission to propose a draft of `kind` as a PR / MR. */
export function proposePermission(kind: DraftKind): string {
  return DRAFT_PERMISSIONS[kind].propose
}

/** The permissions a direct commit of a `kind` draft needs, all of them. */
export function commitPermissions(kind: DraftKind): readonly string[] {
  return DRAFT_PERMISSIONS[kind].commit
}

/** Holds a permission (as `userHasPermission`, bound to the signed-in user and the mode). */
export type PermissionCheck = (permission: string) => boolean

/** Whether a user may commit a `kind` draft straight onto the content branch. */
export function canCommit(kind: DraftKind, has: PermissionCheck): boolean {
  return commitPermissions(kind).every((p) => has(p))
}

/**
 * Who may keep a draft of `kind` (server: `may_draft`): its propose
 * permission, or `reviews:write` for a concept set (a review rides inside
 * the set's file).
 */
export function canDraft(kind: DraftKind, has: PermissionCheck): boolean {
  return has(proposePermission(kind)) || (kind === 'concept-set' && has('reviews:write'))
}

/**
 * Who may edit `kind` (open its editor): anyone who can submit the result
 * some way. A reviewer keeps concept-set drafts for reviews only, so is not
 * an editor.
 */
export function canEdit(kind: DraftKind, has: PermissionCheck): boolean {
  return has(proposePermission(kind)) || canCommit(kind, has)
}

/**
 * The submit modes open to a user for a draft, in display order. A
 * concept-set draft of an existing set that only appends reviews may be
 * proposed with `reviews:write` alone.
 */
export function allowedSubmitModes(kind: DraftKind, has: PermissionCheck, reviewsOnly = false): SubmitMode[] {
  const modes: SubmitMode[] = []
  if (has(proposePermission(kind)) || (kind === 'concept-set' && reviewsOnly && has('reviews:write'))) {
    modes.push('proposal')
  }
  if (canCommit(kind, has)) modes.push('commit')
  return modes
}
