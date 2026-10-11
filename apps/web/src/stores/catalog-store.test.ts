import { describe, expect, it, vi } from 'vitest'
import type { DictionarySource } from '@/lib/data'
import { conceptSetKey, createCatalogStore, resolvedKey } from './catalog-store'

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function fakeSource(overrides: Partial<DictionarySource>): DictionarySource {
  return { mode: 'static', ...overrides } as DictionarySource
}

describe('keys', () => {
  it('separate versions and queries', () => {
    expect(conceptSetKey(1)).toBe('1')
    expect(conceptSetKey(1, '1.0.0')).toBe('1@1.0.0')
    expect(resolvedKey(1, { search: ' Glu ', offset: 10, limit: 5 })).toBe('1?glu&10&5')
    expect(resolvedKey(1, { version: '2.0.0' })).toBe('1@2.0.0?&0&')
  })
})

describe('catalog store', () => {
  it('loads a list once, sharing concurrent calls', async () => {
    const listConceptSets = vi.fn(async () => [])
    const store = createCatalogStore(() => fakeSource({ listConceptSets }))
    await Promise.all([store.getState().loadConceptSets(), store.getState().loadConceptSets()])
    await store.getState().loadConceptSets()
    expect(listConceptSets).toHaveBeenCalledTimes(1)
    expect(store.getState().conceptSets).toEqual({ data: [], status: 'ready', error: null })
    await store.getState().loadConceptSets(true)
    expect(listConceptSets).toHaveBeenCalledTimes(2)
  })

  it('records a failure and retries on the next call', async () => {
    const listProjects = vi.fn().mockRejectedValueOnce(new Error('HTTP 500')).mockResolvedValueOnce([{ id: 1 }])
    const store = createCatalogStore(() => fakeSource({ listProjects }))
    await store.getState().loadProjects()
    expect(store.getState().projects).toEqual({ data: null, status: 'error', error: 'HTTP 500' })
    await store.getState().loadProjects()
    expect(store.getState().projects.status).toBe('ready')
  })

  it('keeps not-found apart from loading', async () => {
    const getConceptSet = vi.fn(async () => null)
    const store = createCatalogStore(() => fakeSource({ getConceptSet }))
    const pending = store.getState().loadConceptSet(9, '1.0.0')
    expect(store.getState().conceptSetDetails['9@1.0.0'].status).toBe('loading')
    await pending
    expect(store.getState().conceptSetDetails['9@1.0.0']).toEqual({ data: null, status: 'ready', error: null })
  })

  it('drops a response that arrives after reset', async () => {
    const gate = deferred<never[]>()
    const store = createCatalogStore(() => fakeSource({ listConceptSets: () => gate.promise }))
    const pending = store.getState().loadConceptSets()
    store.getState().reset()
    gate.resolve([])
    await pending
    expect(store.getState().conceptSets.status).toBe('idle')
  })

  it('keeps only the most recent resolved pages', async () => {
    const getResolved = vi.fn(async (id: number) => ({ conceptSetId: id }) as never)
    const store = createCatalogStore(() => fakeSource({ getResolved }))
    for (let i = 1; i <= 25; i++) await store.getState().loadResolved(i)
    const keys = Object.keys(store.getState().resolved)
    expect(keys).toHaveLength(20)
    expect(keys[0]).toBe(resolvedKey(6))
    expect(keys.at(-1)).toBe(resolvedKey(25))
  })
})
