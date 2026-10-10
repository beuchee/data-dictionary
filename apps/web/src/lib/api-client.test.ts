import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiFetch, apiRequest } from './api-client'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const authHeader = (call: unknown[]) => new Headers((call[1] as RequestInit).headers).get('Authorization')

describe('apiFetch', () => {
  let storage: ReturnType<typeof memoryStorage>

  beforeEach(() => {
    storage = memoryStorage({ 'dd-access-token': 'old', 'dd-refresh-token': 'r1' })
    vi.stubGlobal('localStorage', storage)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the stored token as a Bearer header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({}))
    vi.stubGlobal('fetch', fetchMock)
    await apiFetch('/api/v1/x')
    expect(authHeader(fetchMock.mock.calls[0])).toBe('Bearer old')
  })

  it('refreshes once on 401 and retries with the new token', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/auth/refresh')) return json({ access_token: 'new', refresh_token: 'r2', user: { id: 1 } })
      return new Headers(init?.headers).get('Authorization') === 'Bearer new' ? json({ ok: 1 }) : json({}, 401)
    })
    vi.stubGlobal('fetch', fetchMock)
    const res = await apiFetch('/api/v1/x')
    expect(res.status).toBe(200)
    expect(storage.data.get('dd-access-token')).toBe('new')
    expect(storage.data.get('dd-refresh-token')).toBe('r2')
  })

  it('shares one refresh between concurrent 401s', async () => {
    let refreshes = 0
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/auth/refresh')) {
        refreshes++
        await new Promise((r) => setTimeout(r, 5))
        return json({ access_token: 'new', refresh_token: 'r2', user: {} })
      }
      return new Headers(init?.headers).get('Authorization') === 'Bearer new' ? json({}) : json({}, 401)
    })
    vi.stubGlobal('fetch', fetchMock)
    const results = await Promise.all([apiFetch('/a'), apiFetch('/b'), apiFetch('/c')])
    expect(results.map((r) => r.status)).toEqual([200, 200, 200])
    expect(refreshes).toBe(1)
  })

  it('clears the tokens when the refresh is refused', async () => {
    const fetchMock = vi.fn(async () => json({}, 401))
    vi.stubGlobal('fetch', fetchMock)
    const res = await apiFetch('/api/v1/x')
    expect(res.status).toBe(401)
    expect(storage.data.has('dd-access-token')).toBe(false)
    expect(storage.data.has('dd-refresh-token')).toBe(false)
  })
})

describe('apiRequest', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('prefixes /api/v1 and parses JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ ok: 1 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(apiRequest('/things')).resolves.toEqual({ ok: 1 })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/things')
  })

  it('throws ApiError with the status on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Not found', { status: 404 })))
    const err = await apiRequest('/missing').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(404)
  })

  it('returns undefined on 204', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
    await expect(apiRequest('/x', { method: 'DELETE' })).resolves.toBeUndefined()
  })
})
