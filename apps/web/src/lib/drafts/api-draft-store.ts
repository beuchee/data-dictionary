import { parse, serialize } from '@data-dictionary/format'
import { ApiError, apiFetch } from '@/lib/api-client'
import type { Draft, DraftContentByKind, DraftKind, DraftOf, DraftStore, NewDraft, SubmitMode, SubmitResult } from './types'

/** `GET /git/status` (docs/design/drafts-and-proposals.md). */
export interface GitStatus {
  /** The working copy's branch. */
  branch: string | null
  /** The branch content is committed to. */
  contentBranch: string | null
  /** The working copy's HEAD: what the API serves, so what an edit starts from. */
  head: string | null
  remote: string | null
  /** The remote's head at the last fetch. */
  remoteHead: string | null
  /** null before the first fetch. */
  ahead: number | null
  behind: number | null
  dirty: boolean
}

/** `POST /git/pull`. */
export interface PullResult {
  before: string | null
  head: string | null
  updated: boolean
  /** Versions indexed by the backfill that follows the pull. */
  indexed: { id: string | number; version: string; commit: string }[]
  indexCommitSha: string | null
  indexError?: { code: string; message: string } | null
}

type FetchLike = (path: string, init?: RequestInit) => Promise<Response>

/** A draft as the API returns it; ids may come back as numbers. */
interface WireDraft extends Omit<Draft, 'id'> {
  id: string | number
}

function toDraft(wire: WireDraft): Draft {
  return { ...wire, id: String(wire.id) } as Draft
}

/**
 * Server mode: the `/api/v1/drafts` routes. Bodies are written with the format
 * package's `serialize` and read with its lossless `parse`, so number lexemes
 * of the content (`1.0` in `distributionStats`) survive the round trip.
 */
export class ApiDraftStore implements DraftStore {
  readonly mode = 'server' as const
  private readonly fetchFn: FetchLike

  constructor(fetchFn: FetchLike = apiFetch) {
    this.fetchFn = fetchFn
  }

  private async request<T>(path: string, init: RequestInit = {}, body?: unknown): Promise<T> {
    const headers = new Headers(init.headers)
    if (body !== undefined) headers.set('Content-Type', 'application/json')
    const res = await this.fetchFn(`/api/v1${path}`, {
      ...init,
      headers,
      body: body === undefined ? undefined : serialize(body, { trailingNewline: false }),
    })
    if (!res.ok) throw new ApiError(res.status, await res.text())
    if (res.status === 204) return undefined as T
    const text = await res.text()
    return (text ? parse<T>(text) : undefined) as T
  }

  /** The content repo's status, or null when the API does not tell (no permission, not a git repo). */
  async gitStatus(): Promise<GitStatus | null> {
    try {
      return await this.request<GitStatus>('/git/status')
    } catch {
      return null
    }
  }

  /** The content repo's status, fetching the remote first when `fetch` (ahead / behind current); rejects on failure. */
  fetchGitStatus(fetch = false): Promise<GitStatus> {
    return this.request<GitStatus>(`/git/status${fetch ? '?fetch=true' : ''}`)
  }

  async list(): Promise<Draft[]> {
    return (await this.request<WireDraft[]>('/drafts')).map(toDraft)
  }

  async get(id: string): Promise<Draft | null> {
    try {
      return toDraft(await this.request<WireDraft>(`/drafts/${encodeURIComponent(id)}`))
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null
      throw error
    }
  }

  async create<K extends DraftKind>(draft: NewDraft<K>): Promise<DraftOf<K>> {
    // The working copy's HEAD is what the API served the edited content from.
    const baseCommit = draft.baseCommit !== undefined ? draft.baseCommit : ((await this.gitStatus())?.head ?? null)
    const body = { kind: draft.kind, targetId: draft.targetId, baseCommit, content: draft.content }
    return toDraft(await this.request<WireDraft>('/drafts', { method: 'POST' }, body)) as DraftOf<K>
  }

  async update<K extends DraftKind>(id: string, content: DraftContentByKind[K]): Promise<DraftOf<K>> {
    return toDraft(
      await this.request<WireDraft>(`/drafts/${encodeURIComponent(id)}`, { method: 'PUT' }, { content }),
    ) as DraftOf<K>
  }

  async remove(id: string): Promise<void> {
    try {
      await this.request<void>(`/drafts/${encodeURIComponent(id)}`, { method: 'DELETE' })
    } catch (error) {
      // Already gone (submitted from another tab): the goal is reached.
      if (!(error instanceof ApiError && error.status === 404)) throw error
    }
  }

  /** Commits the draft (PR / MR branch, or the content branch); see `submitErrorFrom` for failures. */
  submit(id: string, mode: SubmitMode, message: string): Promise<SubmitResult> {
    return this.request<SubmitResult>(`/drafts/${encodeURIComponent(id)}/submit`, { method: 'POST' }, { mode, message })
  }

  /** Fast-forwards the content working copy (maintainers), e.g. after a 409 `pull_required`. */
  pull(): Promise<PullResult> {
    return this.request<PullResult>('/git/pull', { method: 'POST' })
  }
}
