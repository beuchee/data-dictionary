import { ApiError } from '@/lib/api-client'

/**
 * What went wrong submitting (or saving) a draft, for the dialog to explain.
 * The server's codes (`{"detail": {"code", "message", …}}`, contract in
 * docs/design/drafts-and-proposals.md) are kept when the dialog has something
 * specific to say about them, else folded by status.
 */
export type SubmitErrorCode =
  /** 409: the content branch moved on the remote; a maintainer must pull first. */
  | 'pull_required'
  /** 409: the file changed in the repository since the draft was started. */
  | 'base_changed'
  /** 409: that (id, version) is already published: bump the version again. */
  | 'version_published'
  /** 409: the draft is identical to the repository's file. */
  | 'no_changes'
  /** 403: a reviewer's draft changes more than appended reviews. */
  | 'reviews_only'
  /** 404: the edited concept set / project is gone from the repository. */
  | 'target_not_found'
  /** 409: the server's working copy is not in a state to commit (diverged, dirty, wrong branch, no remote…). */
  | 'repository_state'
  /** 502: the forge refused the credentials. */
  | 'forge_auth'
  /** 502: git or the forge failed otherwise (network, unknown repository…). */
  | 'forge'
  /** 409 for any other reason. */
  | 'conflict'
  /** 422: the content failed validation. */
  | 'validation'
  | 'forbidden'
  | 'not_found'
  | 'unauthenticated'
  | 'unreachable'
  | 'server'

export interface SubmitError {
  code: SubmitErrorCode
  /** The server's code as it sent it (`diverged`, `auth_failed`…), when it sent one. */
  serverCode: string | null
  /** The server's message, when it gave one. */
  message: string | null
  /** Validation problems, one line each (`/metadata/reviewStatus: must be equal to one of the allowed values`). */
  issues: string[]
}

function issueLine(issue: unknown): string | null {
  if (typeof issue === 'string') return issue
  if (!issue || typeof issue !== 'object') return null
  const o = issue as Record<string, unknown>
  const where = typeof o.pointer === 'string' ? o.pointer : Array.isArray(o.loc) ? o.loc.join('.') : typeof o.path === 'string' ? o.path : ''
  const what = typeof o.message === 'string' ? o.message : typeof o.msg === 'string' ? o.msg : ''
  if (!what) return where || null
  return where ? `${where}: ${what}` : what
}

const KEPT: Record<string, SubmitErrorCode> = {
  pull_required: 'pull_required',
  base_changed: 'base_changed',
  version_published: 'version_published',
  no_changes: 'no_changes',
  reviews_only: 'reviews_only',
  target_not_found: 'target_not_found',
  invalid_content: 'validation',
  validation: 'validation',
  diverged: 'repository_state',
  dirty: 'repository_state',
  wrong_branch: 'repository_state',
  no_remote: 'repository_state',
  not_a_repo: 'repository_state',
  auth_failed: 'forge_auth',
  auth_required: 'forge_auth',
  forbidden: 'forbidden',
}

/**
 * A submit / save failure in a shape the dialog can show. Reads the FastAPI
 * bodies leniently: `{detail: {code, message, errors}}` (the contract),
 * `{detail: "pull_required"}`, or a 422 `{detail: [{loc, msg}]}`.
 */
export function submitErrorFrom(error: unknown): SubmitError {
  if (!(error instanceof ApiError)) {
    return { code: 'unreachable', serverCode: null, message: error instanceof Error ? error.message : null, issues: [] }
  }
  let detail: unknown = null
  try {
    detail = (JSON.parse(error.message) as { detail?: unknown } | null)?.detail ?? null
  } catch {
    detail = error.message || null
  }
  let code: string | null = null
  let message: string | null = null
  let issues: string[] = []
  if (typeof detail === 'string') {
    if (/^[a-z_]+$/.test(detail)) code = detail
    else message = detail
  } else if (Array.isArray(detail)) {
    issues = detail.map(issueLine).filter((s): s is string => !!s)
  } else if (detail && typeof detail === 'object') {
    const d = detail as Record<string, unknown>
    if (typeof d.code === 'string') code = d.code
    if (typeof d.message === 'string') message = d.message
    const list = Array.isArray(d.errors) ? d.errors : Array.isArray(d.issues) ? d.issues : []
    issues = list.map(issueLine).filter((s): s is string => !!s)
  }

  const byStatus: Record<number, SubmitErrorCode> = {
    401: 'unauthenticated',
    403: 'forbidden',
    404: 'not_found',
    409: 'conflict',
    422: 'validation',
  }
  let resolved: SubmitErrorCode = byStatus[error.status] ?? 'server'
  if (error.status === 502 && code) resolved = 'forge'
  else if (error.status >= 502 && error.status <= 504) resolved = 'unreachable'
  if (code && KEPT[code]) resolved = KEPT[code]
  else if (error.status === 409 && /pull/i.test(message ?? '')) resolved = 'pull_required'
  return { code: resolved, serverCode: code, message, issues }
}
