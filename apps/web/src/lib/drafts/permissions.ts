import type { DraftKind, SubmitMode } from './types'

/** The resource prefix of a draft kind's permissions (`concept-sets:propose`, `mappings:write`…). */
const RESOURCE: Record<DraftKind, string> = {
  'concept-set': 'concept-sets',
  project: 'projects',
  'recommended-units': 'units',
  'unit-conversions': 'units',
  'mapping-recommendations': 'mappings',
  config: 'branding',
}

/**
 * The permission to propose a draft of `kind` as a PR / MR: `:propose` for
 * concept sets and projects, `:write` for the instance-wide files.
 */
export function proposePermission(kind: DraftKind): string {
  return kind === 'concept-set' || kind === 'project' ? `${RESOURCE[kind]}:propose` : `${RESOURCE[kind]}:write`
}

/**
 * The permission to commit a draft of `kind` straight onto the content branch.
 * The contract reserves it to maintainers; the name follows the kind's resource.
 */
export function commitPermission(kind: DraftKind): string {
  return `${RESOURCE[kind]}:commit`
}

/** Holds a permission (as `userHasPermission`, bound to the signed-in user and the mode). */
export type PermissionCheck = (permission: string) => boolean

/** Who may edit (create drafts of) `kind` at all: anyone who can submit them some way. */
export function canEdit(kind: DraftKind, has: PermissionCheck): boolean {
  return has(proposePermission(kind)) || has(commitPermission(kind))
}

/**
 * The submit modes open to a user for a draft, in display order. A
 * concept-set draft that only appends reviews may be proposed with
 * `reviews:write` alone.
 */
export function allowedSubmitModes(kind: DraftKind, has: PermissionCheck, reviewsOnly = false): SubmitMode[] {
  const modes: SubmitMode[] = []
  if (has(proposePermission(kind)) || (kind === 'concept-set' && reviewsOnly && has('reviews:write'))) {
    modes.push('proposal')
  }
  if (has(commitPermission(kind))) modes.push('commit')
  return modes
}
