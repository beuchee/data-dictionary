import { describe, expect, it, vi } from 'vitest'
import { RawNumber, parse, serialize, type ConceptSet } from '@data-dictionary/format'
import * as v1 from '@/lib/export/v1-fixtures'
import { ApiError } from '@/lib/api-client'
import { ApiDraftStore } from './api-draft-store'
import { LocalDraftStore, MemoryDraftBackend } from './local-draft-store'
import { submitErrorFrom } from './submit-errors'

function withRawNumber(): ConceptSet {
  const cs = v1.conceptSet(1)
  return { ...cs, metadata: { ...cs.metadata, distributionStats: { mean: new RawNumber('1.0') } } }
}

describe('LocalDraftStore', () => {
  const make = () => {
    let tick = 0
    let n = 0
    return new LocalDraftStore(new MemoryDraftBackend(), {
      now: () => `2026-10-11T00:00:0${tick++}.000Z`,
      newId: () => `d${++n}`,
    })
  }

  it('creates, lists newest first, updates and removes', async () => {
    const store = make()
    const a = await store.create({ kind: 'concept-set', targetId: 1, content: v1.conceptSet(1) })
    const b = await store.create({ kind: 'project', targetId: null, content: v1.project(1) })
    expect(a).toMatchObject({ id: 'd1', kind: 'concept-set', targetId: 1, baseCommit: null })
    expect((await store.list()).map((d) => d.id)).toEqual(['d2', 'd1'])

    const edited = { ...v1.conceptSet(1), version: '9.9.9' }
    const updated = await store.update<'concept-set'>(a.id, edited)
    expect(updated.content.version).toBe('9.9.9')
    expect(updated.createdAt).toBe(a.createdAt)
    expect(updated.updatedAt > a.updatedAt).toBe(true)
    expect((await store.list())[0].id).toBe('d1')

    await store.remove(b.id)
    expect(await store.get(b.id)).toBeNull()
    await expect(store.update(b.id, v1.project(1))).rejects.toThrow()
  })

  it('keeps number lexemes through storage', async () => {
    const store = make()
    const draft = await store.create({ kind: 'concept-set', targetId: 1, content: withRawNumber() })
    const read = (await store.get(draft.id)) as { content: ConceptSet }
    expect(serialize(read.content, { kind: 'concept-set' })).toContain('"mean": 1.0')
  })
})

function response(status: number, body?: string): Response {
  return new Response(body ?? null, { status })
}

describe('ApiDraftStore', () => {
  it('posts the draft with the HEAD it started from, keeping number lexemes', async () => {
    const calls: { path: string; init?: RequestInit }[] = []
    const fetchFn = vi.fn(async (path: string, init?: RequestInit) => {
      calls.push({ path, init })
      if (path === '/api/v1/git/status') return response(200, '{"branch":"main","head":"abc123","remote":null,"ahead":0,"behind":0,"dirty":false}')
      // Echo the posted content back, as the API would.
      const posted = parse<{ content: unknown }>(init?.body as string)
      const content = serialize(posted.content, { trailingNewline: false })
      return response(201, `{"id": 7, "kind": "concept-set", "targetId": 1, "baseCommit": "abc123", "content": ${content}, "createdAt": "t", "updatedAt": "t"}`)
    })
    const store = new ApiDraftStore(fetchFn)
    const draft = await store.create({ kind: 'concept-set', targetId: 1, content: withRawNumber() })

    expect(calls.map((c) => [c.init?.method ?? 'GET', c.path])).toEqual([
      ['GET', '/api/v1/git/status'],
      ['POST', '/api/v1/drafts'],
    ])
    const body = calls[1].init?.body as string
    expect(body).toContain('"mean": 1.0')
    expect(body).toContain('"baseCommit": "abc123"')
    expect(draft.id).toBe('7')
    expect(serialize(draft.content, { kind: 'concept-set' })).toContain('"mean": 1.0')
  })

  it('starts from an unknown HEAD when the status is refused', async () => {
    const fetchFn = vi.fn(async (path: string, init?: RequestInit) =>
      path.endsWith('/git/status')
        ? response(403, '{"detail":"forbidden"}')
        : response(201, `{"id":"x","kind":"project","targetId":null,"baseCommit":null,"content":{},"createdAt":"t","updatedAt":"t","echo":${init?.body}}`),
    )
    await new ApiDraftStore(fetchFn).create({ kind: 'project', targetId: null, content: v1.project(1) })
    expect(JSON.parse(fetchFn.mock.calls[1][1]?.body as string).baseCommit).toBeNull()
  })

  it('uses the contract routes for update, delete and submit', async () => {
    const fetchFn = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return response(404)
      if (path.endsWith('/submit')) return response(200, '{"mode":"proposal","commitSha":"def","branch":"proposal/ada-concept-set-1-x","proposalUrl":"https://github.com/o/r/pull/3"}')
      return response(200, '{"id":"a b","kind":"concept-set","targetId":1,"baseCommit":null,"content":{},"createdAt":"t","updatedAt":"t"}')
    })
    const store = new ApiDraftStore(fetchFn)
    await store.update('a b', v1.conceptSet(1))
    await store.remove('a b') // a 404 means already gone: no error
    const result = await store.submit('a b', 'proposal', 'Update heart rate')
    expect(fetchFn.mock.calls.map((c) => [c[1]?.method, c[0]])).toEqual([
      ['PUT', '/api/v1/drafts/a%20b'],
      ['DELETE', '/api/v1/drafts/a%20b'],
      ['POST', '/api/v1/drafts/a%20b/submit'],
    ])
    expect(JSON.parse(fetchFn.mock.calls[2][1]?.body as string)).toEqual({ mode: 'proposal', message: 'Update heart rate' })
    expect(result.proposalUrl).toBe('https://github.com/o/r/pull/3')
  })

  it('returns null for an unknown draft and throws ApiError otherwise', async () => {
    const store = new ApiDraftStore(async () => response(404, '{"detail":"Not found"}'))
    expect(await store.get('1')).toBeNull()
    const failing = new ApiDraftStore(async () => response(500, 'boom'))
    await expect(failing.list()).rejects.toBeInstanceOf(ApiError)
  })
})

describe('submitErrorFrom', () => {
  it('recognises pull_required in its possible spellings', () => {
    expect(submitErrorFrom(new ApiError(409, '{"detail":"pull_required"}')).code).toBe('pull_required')
    expect(submitErrorFrom(new ApiError(409, '{"detail":{"code":"pull_required","message":"Remote moved"}}'))).toEqual({
      code: 'pull_required',
      message: 'Remote moved',
      issues: [],
    })
    expect(submitErrorFrom(new ApiError(409, '{"detail":"Branch exists"}')).code).toBe('conflict')
  })

  it('lists validation issues from either 422 shape', () => {
    expect(submitErrorFrom(new ApiError(422, '{"detail":[{"loc":["body","mode"],"msg":"bad value"}]}')).issues).toEqual([
      'body.mode: bad value',
    ])
    const custom = submitErrorFrom(
      new ApiError(422, '{"detail":{"code":"validation","issues":[{"pointer":"/metadata/reviewStatus","message":"must be one of…"}]}}'),
    )
    expect(custom).toMatchObject({ code: 'validation', issues: ['/metadata/reviewStatus: must be one of…'] })
  })

  it('maps statuses and transport failures', () => {
    expect(submitErrorFrom(new ApiError(403, 'not json')).code).toBe('forbidden')
    expect(submitErrorFrom(new ApiError(502, '')).code).toBe('unreachable')
    expect(submitErrorFrom(new ApiError(500, '{"detail":"Git push failed"}'))).toMatchObject({ code: 'server', message: 'Git push failed' })
    expect(submitErrorFrom(new TypeError('Failed to fetch')).code).toBe('unreachable')
  })
})
