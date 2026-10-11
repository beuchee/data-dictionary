import { describe, expect, it } from 'vitest'
import {
  candidateRow,
  catalogCandidates,
  catalogSourceRepo,
  classifyImport,
  fetchFirst,
  fetchRepoCandidates,
  fetchSingleCandidate,
  importedCopy,
  localSets,
  pastedCandidate,
  resolveRepoUrls,
  sourceRepoOfFileUrl,
  toRawFileUrl,
  type ImportCandidate,
} from './cross-repo-import'
import type { ConceptSet } from '@data-dictionary/format'

function set(id: number, uniqueId: string | null, version = '1.0.0', extra: Record<string, unknown> = {}): ConceptSet {
  return {
    id,
    name: `Set ${id}`,
    description: null,
    version,
    createdBy: 'Ana',
    createdDate: '2025-01-01',
    modifiedBy: 'Ana',
    modifiedDate: '2025-01-01',
    createdByTool: 'x',
    expression: { items: [] },
    tags: [],
    metadata: {
      uniqueId: uniqueId as string,
      organization: { name: 'Source Org', url: 'https://source.example' },
      reviewStatus: 'approved',
      translations: { en: { name: `Set ${id}`, category: 'Labs', subcategory: 'Blood', shortDescription: 'Short' } },
      createdByDetails: null,
      reviews: [],
      versions: [],
      distributionStats: null,
      ...extra,
    },
  } as ConceptSet
}

describe('resolveRepoUrls', () => {
  it('GitHub: the Pages site (v1 build, v2 static build), then the raw tree; the index on raw', () => {
    expect(resolveRepoUrls('https://github.com/Indicate-EU/data-dictionary.git/')).toEqual({
      dataJson: [
        'https://indicate-eu.github.io/data-dictionary/data.json',
        'https://indicate-eu.github.io/data-dictionary/data/data.json',
        'https://raw.githubusercontent.com/Indicate-EU/data-dictionary/main/docs/data.json',
        'https://raw.githubusercontent.com/Indicate-EU/data-dictionary/main/legacy/data.json',
      ],
      versions: 'https://raw.githubusercontent.com/Indicate-EU/data-dictionary/main/concept_sets_versions.json',
    })
  })

  it('GitLab Pages and /-/raw/', () => {
    const r = resolveRepoUrls('https://gitlab.com/MyGroup/dict')!
    expect(r.dataJson[0]).toBe('https://mygroup.gitlab.io/dict/data.json')
    expect(r.dataJson[2]).toBe('https://gitlab.com/MyGroup/dict/-/raw/main/docs/data.json')
    expect(r.versions).toBe('https://gitlab.com/MyGroup/dict/-/raw/main/concept_sets_versions.json')
  })

  it('a direct data.json, a /docs folder, any other host', () => {
    expect(resolveRepoUrls('https://x.org/site/data.json?v=2')).toEqual({ dataJson: ['https://x.org/site/data.json?v=2'], versions: null })
    expect(resolveRepoUrls('https://x.org/repo/docs/')).toEqual({
      dataJson: ['https://x.org/repo/docs/data.json'],
      versions: 'https://x.org/repo/concept_sets_versions.json',
    })
    expect(resolveRepoUrls('https://pages.example.org/dict')!.dataJson).toEqual([
      'https://pages.example.org/dict/data.json',
      'https://pages.example.org/dict/data/data.json',
      'https://pages.example.org/dict/docs/data.json',
      'https://pages.example.org/dict/legacy/data.json',
    ])
  })

  it.each(['', '   ', 'github.com/a/b', 'ftp://x.org/data.json', 'javascript:alert(1)'])('refuses %j', (input) => {
    expect(resolveRepoUrls(input)).toBeNull()
  })
})

describe('file URLs', () => {
  it('turns forge view pages into raw files', () => {
    expect(toRawFileUrl('https://github.com/o/r/blob/main/concept_sets/10.json')).toBe('https://raw.githubusercontent.com/o/r/main/concept_sets/10.json')
    expect(toRawFileUrl('https://gitlab.com/g/sub/r/-/blob/main/concept_sets/10.json')).toBe('https://gitlab.com/g/sub/r/-/raw/main/concept_sets/10.json')
    expect(toRawFileUrl(' https://x.org/10.json ')).toBe('https://x.org/10.json')
  })

  it('guesses the source repository of a raw file', () => {
    expect(sourceRepoOfFileUrl('https://raw.githubusercontent.com/o/r/main/concept_sets/10.json')).toBe('https://raw.githubusercontent.com/o/r/main')
    expect(sourceRepoOfFileUrl('https://gitlab.com/g/r/-/raw/main/concept_sets/10.json')).toBe('https://gitlab.com/g/r')
  })

  it('credits a catalog to its configured repository, else to what was typed', () => {
    expect(catalogSourceRepo({ repository: { url: 'https://gitlab.com/g/r.git' } }, 'https://x')).toBe('https://gitlab.com/g/r')
    expect(catalogSourceRepo({ github: { upstream: 'https://github.com/o/r' } }, 'https://x')).toBe('https://github.com/o/r')
    expect(catalogSourceRepo({ repository: { repo: 'o/r' } }, 'https://o.github.io/r/data/data.json')).toBe('https://o.github.io/r')
    expect(catalogSourceRepo(null, 'https://x.org/r/docs/data.json')).toBe('https://x.org/r')
  })
})

describe('classification', () => {
  const local = [
    { id: 4, uniqueId: 'u-1', version: '1.0.0' },
    { id: 9, uniqueId: 'u-2', version: '2.0.0' },
  ]

  it('keys on the lineage id', () => {
    expect(classifyImport(set(50, 'u-1'), local)).toEqual({ status: 'up_to_date', localId: 4 })
    expect(classifyImport(set(51, 'u-2', '2.1.0'), local)).toEqual({ status: 'conflict', localId: 9 })
    expect(classifyImport(set(52, 'u-3'), local)).toEqual({ status: 'new', localId: null })
    expect(classifyImport(set(53, null), local)).toEqual({ status: 'new', localId: null })
  })

  it('sees the user’s drafts over the repository', () => {
    const merged = localSets(local, [{ id: 4, uniqueId: 'u-1', version: '1.1.0' }, { id: 77, uniqueId: 'u-9', version: '1.0.0' }])
    expect(classifyImport(set(1, 'u-1', '1.1.0'), merged).status).toBe('up_to_date')
    expect(classifyImport(set(1, 'u-9'), merged)).toEqual({ status: 'up_to_date', localId: 77 })
  })

  it('builds catalog candidates with the source commit, new ones selected', () => {
    const data = { conceptSets: [set(1, 'u-1'), set(2, 'u-2', '3.0.0'), set(3, 'u-3'), { not: 'a set' }] }
    const c = catalogCandidates(data, { 2: { '3.0.0': 'abc1234' } }, 'https://src', local)
    expect(c.map((x) => [x.cs.id, x.status, x.selected, x.sourceCommit])).toEqual([
      [1, 'up_to_date', false, null],
      [2, 'conflict', false, 'abc1234'],
      [3, 'new', true, null],
    ])
    expect(catalogCandidates({ conceptSets: 'x' }, null, '', local)).toEqual([])
  })

  it('shows rows in the content language with v1’s fallbacks', () => {
    const c: ImportCandidate = { cs: set(7, 'u'), sourceRepoUrl: '', sourceCommit: null, status: 'new', localId: null, selected: true }
    expect(candidateRow(c, 3, 'en')).toEqual({
      index: 3, name: 'Set 7', category: 'Labs', subcategory: 'Blood', version: '1.0.0', organization: 'Source Org', description: 'Short', status: 'new',
    })
    expect(candidateRow(c, 3, 'fr')).toMatchObject({ name: 'Set 7', category: '', description: '' })
  })
})

describe('importedCopy', () => {
  const ctx = { organization: { name: 'My Org', url: 'https://my.example' }, repoUrl: 'https://github.com/me/dict', today: '2026-10-11' }

  it('freezes the origin, takes ownership, keeps the lineage and author', () => {
    const source = set(12, 'u-1', '1.2.0', { sourceRepo: 'https://github.com/src/dict' })
    const c: ImportCandidate = { cs: source, sourceRepoUrl: 'https://github.com/src/dict', sourceCommit: 'abcdef1', status: 'new', localId: null, selected: true }
    const out = importedCopy(c, 345, ctx)
    expect(out.id).toBe(345)
    expect(out.metadata.uniqueId).toBe('u-1')
    expect(out.metadata.organization).toEqual({
      created: { name: 'Source Org', url: 'https://source.example' },
      current: { name: 'My Org', url: 'https://my.example' },
    })
    expect(out.metadata.sourceRepo).toBe('https://github.com/me/dict')
    expect(out.metadata.origin).toEqual({
      uniqueId: 'u-1',
      repo: 'https://github.com/src/dict',
      version: '1.2.0',
      commit: 'abcdef1',
      organization: { name: 'Source Org', url: 'https://source.example' },
      importedDate: '2026-10-11',
    })
    // Canonical order: organization, sourceRepo, reviewStatus, origin, translations…
    expect(Object.keys(out.metadata).slice(0, 6)).toEqual(['uniqueId', 'organization', 'sourceRepo', 'reviewStatus', 'origin', 'translations'])
    expect(source.metadata.origin).toBeUndefined()
    expect(source.id).toBe(12)
  })

  it('credits a pasted set to its own sourceRepo; replaces an older origin', () => {
    const source = set(1, 'u-1', '2.0.0', { sourceRepo: 'https://gitlab.com/a/b', origin: { uniqueId: 'u-1', repo: 'https://old', version: '1.0.0' } })
    const out = importedCopy(pastedCandidate(JSON.stringify(source), []), 8, ctx)
    expect(out.metadata.origin).toMatchObject({ repo: 'https://gitlab.com/a/b', version: '2.0.0', commit: null })
  })
})

describe('fetching', () => {
  const catalog = { config: { repository: { url: 'https://github.com/src/dict' } }, conceptSets: [set(1, 'u-1')] }

  it('tries the catalog locations in order', async () => {
    const tried: string[] = []
    const fetchJson = async (url: string) => {
      tried.push(url)
      if (url.endsWith('/data/data.json')) return catalog
      if (url.endsWith('concept_sets_versions.json')) return { 1: { '1.0.0': 'f00ba12' } }
      throw new Error('HTTP 404')
    }
    const c = await fetchRepoCandidates('https://github.com/src/dict', [], fetchJson)
    expect(tried.filter((u) => u.endsWith('data.json'))).toEqual(['https://src.github.io/dict/data.json', 'https://src.github.io/dict/data/data.json'])
    expect(c[0]).toMatchObject({ sourceRepoUrl: 'https://github.com/src/dict', sourceCommit: 'f00ba12', status: 'new' })
  })

  it('reports the last failure when no location answers, skips non-catalogs', async () => {
    await expect(fetchFirst(['a', 'b'], async (u) => (u === 'a' ? { hello: 1 } : Promise.reject(new Error('HTTP 500'))))).rejects.toThrow('HTTP 500')
    await expect(fetchRepoCandidates('not a url', [], async () => catalog)).rejects.toThrow('invalid_url')
  })

  it('loads one set from a forge page or pasted JSON', async () => {
    const c = await fetchSingleCandidate('https://github.com/o/r/blob/main/concept_sets/1.json', [{ id: 3, uniqueId: 'u-1', version: '0.9.0' }], async (url) => {
      expect(url).toBe('https://raw.githubusercontent.com/o/r/main/concept_sets/1.json')
      return set(1, 'u-1')
    })
    expect(c).toMatchObject({ status: 'conflict', localId: 3, selected: true })
    await expect(fetchSingleCandidate('https://x/1.json', [], async () => [1])).rejects.toThrow('not_a_concept_set')
    expect(() => pastedCandidate('{oops', [])).toThrow('invalid_json')
    expect(() => pastedCandidate('{"id": 1}', [])).toThrow('not_a_concept_set')
  })
})
