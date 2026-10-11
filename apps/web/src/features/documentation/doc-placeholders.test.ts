import { describe, expect, it } from 'vitest'
import { normalizeInstanceConfig, type InstanceConfig } from '@/lib/config'
import { docVariables, placeholderNames, substitutePlaceholders } from './doc-placeholders'

const INDICATE: InstanceConfig = normalizeInstanceConfig({
  title: 'INDICATE Data Dictionary',
  languages: ['en', 'fr'],
  defaultLanguage: 'en',
  repository: { url: 'https://github.com/indicate-eu/data-dictionary', repo: 'indicate-eu/data-dictionary', branch: 'main' },
  organization: { name: 'INDICATE Consortium', url: 'https://indicate-eu.org' },
  customVocabulary: { id: 'INDICATE', codePrefix: 'INDICATE-' },
})

describe('docVariables', () => {
  it('reads the instance values from config.json', () => {
    expect(docVariables(INDICATE)).toEqual({
      'app.name': 'INDICATE Data Dictionary',
      'organization.name': 'INDICATE Consortium',
      'organization.url': 'https://indicate-eu.org',
      'customVocabulary.id': 'INDICATE',
      'customVocabulary.codePrefix': 'INDICATE-',
      'forge.name': 'GitHub',
      'repository.url': 'https://github.com/indicate-eu/data-dictionary',
      'repository.slug': 'indicate-eu/data-dictionary',
      'repository.branch': 'main',
      'repository.blobUrl': 'https://github.com/indicate-eu/data-dictionary/blob/main',
    })
  })

  it('prefers branding.appName over the title', () => {
    expect(docVariables({ ...INDICATE, branding: { appName: 'ICU Dictionary' } })['app.name']).toBe('ICU Dictionary')
  })

  it('names GitLab and its /-/blob/ path for a GitLab fork', () => {
    const vars = docVariables({
      ...INDICATE,
      repository: { url: 'https://gitlab.example.org/team/sub/dict.git', branch: 'develop' },
    })
    expect(vars['forge.name']).toBe('GitLab')
    expect(vars['repository.url']).toBe('https://gitlab.example.org/team/sub/dict')
    expect(vars['repository.slug']).toBe('team/sub/dict')
    expect(vars['repository.blobUrl']).toBe('https://gitlab.example.org/team/sub/dict/-/blob/develop')
  })

  it("falls back to v1's defaults when the fork left values unset", () => {
    const vars = docVariables(normalizeInstanceConfig({ title: 'Bare', organization: { name: '  ' } }))
    expect(vars['organization.name']).toBe('Your Organization')
    expect(vars['organization.url']).toBe('')
    expect(vars['customVocabulary.id']).toBe('CUSTOM')
    expect(vars['repository.url']).toBe('')
    expect(vars['repository.blobUrl']).toBe('')
    expect(vars['repository.branch']).toBe('main')
  })
})

describe('substitutePlaceholders', () => {
  const vars = docVariables(INDICATE)

  it('replaces every occurrence, tolerating inner spaces', () => {
    expect(substitutePlaceholders('{{app.name}} on {{ forge.name }}, by {{organization.name}} ({{app.name}})', vars)).toBe(
      'INDICATE Data Dictionary on GitHub, by INDICATE Consortium (INDICATE Data Dictionary)',
    )
  })

  it('fills link targets', () => {
    expect(substitutePlaceholders('[issues]({{repository.url}}/issues)', vars)).toBe(
      '[issues](https://github.com/indicate-eu/data-dictionary/issues)',
    )
  })

  it('leaves unknown names, single braces and malformed markers as written', () => {
    const text = '{{nope}} {{organization.nam}} {id} {{ }} {{1abc}} `{{forge.name`'
    expect(substitutePlaceholders(text, vars)).toBe(text)
  })

  it('does not resolve inherited object keys', () => {
    expect(substitutePlaceholders('{{constructor}} {{toString}}', vars)).toBe('{{constructor}} {{toString}}')
  })

  it('substitutes once: a value that looks like a placeholder stays literal', () => {
    const tricky = { ...vars, 'organization.name': '{{app.name}}' }
    expect(substitutePlaceholders('{{organization.name}}', tricky)).toBe('{{app.name}}')
  })

  it('lists the names a text uses', () => {
    expect(placeholderNames('{{a.b}} {{ c }} {{a.b}} {x}')).toEqual(['a.b', 'c'])
  })
})
