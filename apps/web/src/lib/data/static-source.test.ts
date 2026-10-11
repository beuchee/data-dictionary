import { describe, expect, it, vi } from 'vitest'
import { StaticSource, locateVersion } from './static-source'
import type { ConceptSet, ResolvedConceptSet, StaticPayload } from './types'

const SHA_OLD = 'a'.repeat(40)
const SHA_BIG = 'b'.repeat(40)

function conceptSet(id: number, version: string, name = `Set ${id}`): ConceptSet {
  return {
    id,
    name,
    description: null,
    version,
    createdBy: null,
    createdDate: '2026-01-01',
    modifiedBy: null,
    modifiedDate: '2026-01-02',
    createdByTool: null,
    expression: { items: [] },
    tags: [],
    metadata: {
      uniqueId: `u-${id}`,
      organization: { name: 'Org', url: null },
      reviewStatus: 'draft',
      translations: { en: { name } },
      createdByDetails: null,
      reviews: [],
      versions: [],
      distributionStats: null,
    },
  }
}

function resolved(id: number, n: number): ResolvedConceptSet {
  return {
    conceptSetId: id,
    vocabularyVersion: null,
    resolvedConcepts: Array.from({ length: n }, (_, i) => ({
      conceptId: id * 100 + i,
      conceptName: `C${i}`,
      vocabularyId: 'LOINC',
      domainId: 'Measurement',
      conceptClassId: 'Lab Test',
      conceptCode: String(i),
      standardConcept: 'S' as const,
    })),
  }
}

function payload(repoUrl = 'https://github.com/org/dd'): StaticPayload {
  return {
    config: { title: 'T', languages: ['en'], defaultLanguage: 'en', repository: { url: repoUrl } },
    conceptSets: [conceptSet(2, '2.0.0'), conceptSet(1, '1.1.0')],
    projects: [{ id: 3, translations: {} }, { id: 1, translations: {} }],
    resolvedConceptSets: [
      resolved(1, 3),
      { conceptSetId: 2, vocabularyVersion: null, resolvedConcepts: [], resolvedDeferred: true, resolvedCount: 150 },
    ],
    conceptSetVersions: { '1': { '1.0.0': conceptSet(1, '1.0.0', 'Inlined old') } },
    conceptSetVersionsIndex: { '1': { '1.0.0': SHA_OLD, '1.1.0': SHA_OLD }, '2': { '1.0.0': SHA_BIG } },
    unitConversions: [],
    recommendedUnits: [],
    mappingRecommendations: null,
  }
}

function fakeFetch(files: Record<string, unknown>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (!(url in files)) return new Response('not found', { status: 404 })
    const body = files[url]
    if (body instanceof Error) throw body
    return new Response(JSON.stringify(body), { status: 200 })
  })
}

function source(files: Record<string, unknown>, data = payload()) {
  const fetch = fakeFetch({ '/app/data/data.json': data, ...files })
  return { fetch, src: new StaticSource({ baseUrl: '/app/', fetch }) }
}

describe('locateVersion', () => {
  const p = payload()

  it('serves the current version from the payload', () => {
    expect(locateVersion(p, 1, undefined, 'definition')).toEqual({ kind: 'current' })
    expect(locateVersion(p, 1, '1.1.0', 'definition')).toEqual({ kind: 'current' })
  })

  it('uses an inlined definition, never an inlined resolved list', () => {
    expect(locateVersion(p, 1, '1.0.0', 'definition')).toMatchObject({ kind: 'inlined' })
    expect(locateVersion(p, 1, '1.0.0', 'resolved')).toEqual({ kind: 'remote', sha: SHA_OLD })
  })

  it('fetches anything else at the indexed commit, and knows nothing of unindexed versions', () => {
    expect(locateVersion(p, 2, '1.0.0', 'definition')).toEqual({ kind: 'remote', sha: SHA_BIG })
    expect(locateVersion(p, 2, '9.0.0', 'definition')).toEqual({ kind: 'unknown' })
    expect(locateVersion(p, 99, undefined, 'definition')).toEqual({ kind: 'unknown' })
  })
})

describe('StaticSource', () => {
  it('summarizes concept sets by id, with inline and deferred counts', async () => {
    const { src } = source({})
    const list = await src.listConceptSets()
    expect(list.map((s) => [s.id, s.resolvedCount])).toEqual([
      [1, 3],
      [2, 150],
    ])
    expect(list[0].organization).toEqual({ created: { name: 'Org', url: null }, current: { name: 'Org', url: null } })
  })

  it('loads the payload once', async () => {
    const { src, fetch } = source({})
    await Promise.all([src.listConceptSets(), src.listProjects(), src.getConceptSet(1)])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect((await src.listProjects()).map((p) => p.id)).toEqual([1, 3])
  })

  it('tells the developer to run build.py when the payload is missing', async () => {
    const fetch = fakeFetch({})
    const src = new StaticSource({ baseUrl: '/', fetch })
    await expect(src.listConceptSets()).rejects.toThrow('python3 build.py')
  })

  it('returns current, inlined and remote definitions', async () => {
    const remote = conceptSet(2, '1.0.0', 'From GitHub')
    const { src, fetch } = source({ [`https://raw.githubusercontent.com/org/dd/${SHA_BIG}/concept_sets/2.json`]: remote })
    expect((await src.getConceptSet(1))?.version).toBe('1.1.0')
    expect((await src.getConceptSet(1, '1.0.0'))?.name).toBe('Inlined old')
    expect((await src.getConceptSet(2, '1.0.0'))?.name).toBe('From GitHub')
    expect(await src.getConceptSet(2, '3.0.0')).toBeNull()
    expect(await src.getConceptSet(42)).toBeNull()
    await src.getConceptSet(2, '1.0.0')
    expect(fetch).toHaveBeenCalledTimes(2) // payload + one remote fetch, then cached
  })

  it('fetches from GitLab’s raw endpoint on a GitLab fork', async () => {
    const remote = conceptSet(2, '1.0.0', 'From GitLab')
    const { src } = source(
      { [`https://framagit.org/team/dd/-/raw/${SHA_BIG}/concept_sets/2.json`]: remote },
      payload('https://framagit.org/team/dd'),
    )
    expect((await src.getConceptSet(2, '1.0.0'))?.name).toBe('From GitLab')
  })

  it('degrades to null when the forge cannot be reached', async () => {
    const { src } = source({
      [`https://raw.githubusercontent.com/org/dd/${SHA_BIG}/concept_sets/2.json`]: new TypeError('offline'),
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await src.getConceptSet(2, '1.0.0')).toBeNull()
  })

  it('pages inline, deferred and past resolved lists', async () => {
    const { src, fetch } = source({
      '/app/data/concept_sets_resolved/2.json': resolved(2, 150),
      [`https://raw.githubusercontent.com/org/dd/${SHA_OLD}/concept_sets_resolved/1.json`]: resolved(1, 7),
    })
    const inline = await src.getResolved(1)
    expect(inline).toMatchObject({ conceptSetId: 1, version: '1.1.0', total: 3, offset: 0, limit: null })

    const deferred = await src.getResolved(2, { offset: 140, limit: 50 })
    expect(deferred?.total).toBe(150)
    expect(deferred?.resolvedConcepts).toHaveLength(10)
    await src.getResolved(2, { search: '2001' })
    expect(fetch.mock.calls.filter(([u]) => String(u).endsWith('concept_sets_resolved/2.json'))).toHaveLength(1)

    const past = await src.getResolved(1, { version: '1.0.0' })
    expect(past).toMatchObject({ version: '1.0.0', total: 7 })
    expect(await src.getResolved(1, { version: '0.1.0' })).toBeNull()
    expect(await src.getResolved(42)).toBeNull()
  })

  it('lists versions from the index and the current file', async () => {
    const { src } = source({})
    const versions = await src.getConceptSetVersions(1)
    expect(versions?.currentVersion).toBe('1.1.0')
    expect(versions?.versions.map((v) => [v.version, v.isCurrent, v.commit])).toEqual([
      ['1.1.0', true, SHA_OLD],
      ['1.0.0', false, SHA_OLD],
    ])
    expect(await src.getConceptSetVersions(42)).toBeNull()
  })
})
