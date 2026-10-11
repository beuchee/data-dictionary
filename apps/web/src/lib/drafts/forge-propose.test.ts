import { describe, expect, it } from 'vitest'
import { FORGE_PREFILL_MAX, forgeFileUrl, forgePath, proposeSteps } from './forge-propose'

const github = { url: 'https://github.com/indicate-eu/data-dictionary', branch: 'main' }
const gitlab = { url: 'https://gitlab.com/team/sub/dd', branch: 'dev' }

describe('forgePath', () => {
  it('namespaces GitLab routes under /-/ but not GitHub ones', () => {
    expect(forgePath(github, 'edit', 'main', '/concept_sets/1.json')).toBe(
      'https://github.com/indicate-eu/data-dictionary/edit/main/concept_sets/1.json',
    )
    expect(forgePath(gitlab, 'blob', 'dev', 'projects/2.json')).toBe('https://gitlab.com/team/sub/dd/-/blob/dev/projects/2.json')
  })

  it('derives the slug from the URL when `repo` is missing (no `//-/`)', () => {
    expect(forgePath({ url: 'https://gitlab.com/a/b/' }, 'edit', 'main', 'x.json')).toBe('https://gitlab.com/a/b/-/edit/main/x.json')
  })
})

describe('forgeFileUrl', () => {
  it('sends an existing file to the edit page, never prefilled', () => {
    expect(forgeFileUrl(github, 'concept_sets/12.json', { isNew: false, content: '{}' })).toEqual({
      url: 'https://github.com/indicate-eu/data-dictionary/edit/main/concept_sets/12.json',
      prefilled: false,
    })
    expect(forgeFileUrl({ url: 'https://github.com/a/b' }, 'x.json', { isNew: false }).url).toContain('/edit/main/')
  })

  it('prefills a small new file (GitHub: filename + value)', () => {
    const { url, prefilled } = forgeFileUrl(github, 'concept_sets/400.json', { isNew: true, content: '{"a": "é&"}\n' })
    expect(prefilled).toBe(true)
    expect(url).toBe(
      'https://github.com/indicate-eu/data-dictionary/new/main?filename=concept_sets%2F400.json&value=%7B%22a%22%3A%20%22%C3%A9%26%22%7D%0A',
    )
  })

  it('prefills a small new file (GitLab: path in the URL, file_name + content)', () => {
    const { url, prefilled } = forgeFileUrl(gitlab, 'projects/7.json', { isNew: true, content: '{}' })
    expect(prefilled).toBe(true)
    expect(url).toBe('https://gitlab.com/team/sub/dd/-/new/dev/?file_name=projects%2F7.json&content=%7B%7D')
  })

  it('falls back to an empty create page past the URL cap', () => {
    const content = 'x'.repeat(FORGE_PREFILL_MAX)
    expect(forgeFileUrl(github, 'concept_sets/400.json', { isNew: true, content })).toEqual({
      url: 'https://github.com/indicate-eu/data-dictionary/new/main?filename=concept_sets%2F400.json',
      prefilled: false,
    })
  })

  it('counts the encoded length, not the raw one', () => {
    // 1500 "é" are 1500 characters but 9000 once percent-encoded.
    expect(forgeFileUrl(github, 'a.json', { isNew: true, content: 'é'.repeat(1500) }).prefilled).toBe(false)
  })
})

describe('proposeSteps', () => {
  it('explains each of the three hand-offs', () => {
    expect(proposeSteps({ isNew: true, prefilled: true })).toEqual(['step_create', 'step_create_prefilled', 'step_commit'])
    expect(proposeSteps({ isNew: true, prefilled: false })).toContain('step_create_paste')
    expect(proposeSteps({ isNew: false, prefilled: false })).toContain('step_replace_all')
  })
})
