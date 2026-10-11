import { ApiError } from '@/lib/api-client'

export type SubmitErrorCode =
  /** 409: the content branch moved on the remote; a maintainer must pull first. */
  | 'pull_required'
  /** 409 for any other reason (e.g. a branch that already exists). */
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

/**
 * A submit / save failure in a shape the dialog can show. Reads the FastAPI
 * bodies the contract implies, leniently: `{detail: "pull_required"}`,
 * `{detail: {code, message, issues}}`, or a 422 `{detail: [{loc, msg}]}`.
 */
export function submitErrorFrom(error: unknown): SubmitError {
  if (!(error instanceof ApiError)) {
    return { code: 'unreachable', message: error instanceof Error ? error.message : null, issues: [] }
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
    if (Array.isArray(d.issues)) issues = d.issues.map(issueLine).filter((s): s is string => !!s)
  }

  const byStatus: Record<number, SubmitErrorCode> = {
    401: 'unauthenticated',
    403: 'forbidden',
    404: 'not_found',
    409: 'conflict',
    422: 'validation',
  }
  let resolved: SubmitErrorCode = byStatus[error.status] ?? 'server'
  if (code === 'pull_required' || (error.status === 409 && /pull/i.test(message ?? ''))) resolved = 'pull_required'
  if (error.status >= 502 && error.status <= 504) resolved = 'unreachable'
  return { code: resolved, message, issues }
}
