import { describe, expect, it } from 'vitest'
import { forgeName, forgeOrigin, repoRawBase, repositoryConfig, repositorySlug, repositoryUrl } from './forge'

const SHA = '1f50acb5828b1ed66a3ecb054fc976ebbc14cf6e'

describe('repositoryConfig', () => {
  it('prefers `repository`, falls back to the legacy `github` block', () => {
    expect(repositoryConfig({ repository: { url: 'a' }, github: { url: 'b' } })).toEqual({ url: 'a' })
    expect(repositoryConfig({ github: { url: 'b' } })).toEqual({ url: 'b' })
    expect(repositoryConfig({})).toEqual({})
  })
})

describe('forgeName / forgeOrigin', () => {
  it('reads the forge from this repo’s URL, not from upstream', () => {
    const fork = { url: 'https://gitlab.com/team/dd', upstream: 'https://github.com/indicate-eu/data-dictionary.git' }
    expect(forgeOrigin(fork)).toBe('https://gitlab.com')
    expect(forgeName(fork)).toBe('GitLab')
  })

  it('treats any non-GitHub host as GitLab, unless `forge` says otherwise', () => {
    expect(forgeName({ url: 'https://framagit.org/a/b' })).toBe('GitLab')
    expect(forgeName({ url: 'https://code.example.org/a/b', forge: 'GitHub' })).toBe('GitHub')
    expect(forgeName({ url: 'https://github.com/a/b', forge: 'gitlab' })).toBe('GitLab')
  })

  it('defaults to GitHub without a URL', () => {
    expect(forgeOrigin({})).toBe('https://github.com')
    expect(forgeName({ repo: 'a/b' })).toBe('GitHub')
  })
})

describe('repositoryUrl / repositorySlug', () => {
  it('strips .git and trailing slashes', () => {
    expect(repositoryUrl({ url: 'https://github.com/a/b.git' })).toBe('https://github.com/a/b')
    expect(repositoryUrl({ url: 'https://github.com/a/b/' })).toBe('https://github.com/a/b')
  })

  it('derives the slug from the URL when `repo` is missing, subgroups included', () => {
    expect(repositorySlug({ url: 'https://gitlab.com/org/sub/dd' })).toBe('org/sub/dd')
    expect(repositorySlug({ repo: '/a/b/', url: 'https://github.com/x/y' })).toBe('a/b')
  })

  it('falls back to upstream, then to nothing', () => {
    expect(repositoryUrl({ upstream: 'https://github.com/u/p.git' })).toBe('https://github.com/u/p')
    expect(repositorySlug({})).toBe('')
  })
})

describe('repoRawBase', () => {
  it('uses raw.githubusercontent.com on GitHub', () => {
    expect(repoRawBase({ url: 'https://github.com/indicate-eu/data-dictionary' }, SHA)).toBe(
      `https://raw.githubusercontent.com/indicate-eu/data-dictionary/${SHA}/`,
    )
  })

  it('uses /-/raw/ on the repo’s own origin on GitLab, self-hosted included', () => {
    expect(repoRawBase({ url: 'https://gitlab.com/org/sub/dd' }, SHA)).toBe(`https://gitlab.com/org/sub/dd/-/raw/${SHA}/`)
    expect(repoRawBase({ url: 'https://framagit.org/t/dd.git' }, SHA)).toBe(`https://framagit.org/t/dd/-/raw/${SHA}/`)
  })

  it('is null without a slug or with something that is not a commit sha', () => {
    expect(repoRawBase({}, SHA)).toBeNull()
    expect(repoRawBase({ url: 'https://github.com/a/b' }, 'main')).toBeNull()
    expect(repoRawBase({ url: 'https://github.com/a/b' }, '../../x')).toBeNull()
  })
})
