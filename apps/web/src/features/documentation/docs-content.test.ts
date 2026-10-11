import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { normalizeInstanceConfig } from '@/lib/config'
import { UI_LANGUAGES } from '@/lib/i18n'
import { buildDocTable, parseDocPath } from './doc-content'
import { DOC_ICONS } from './doc-icons'
import { DOC_GROUPS, flattenSections, sectionFromHref } from './doc-index'
import { extractHeadings, splitTitle } from './doc-markdown'
import { docVariables, placeholderNames } from './doc-placeholders'

// The Markdown files and index.json shipped in content/docs, read from disk.
const DOCS_DIR = path.resolve(__dirname, '../../content/docs')
const LANGS = readdirSync(DOCS_DIR).filter((f) => statSync(path.join(DOCS_DIR, f)).isDirectory())
const FILES = LANGS.flatMap((lang) =>
  readdirSync(path.join(DOCS_DIR, lang)).map((file) => ({ lang, file, text: readFileSync(path.join(DOCS_DIR, lang, file), 'utf-8') })),
)
const SECTIONS = flattenSections()
const IDS = SECTIONS.map((s) => s.id)
const KNOWN_VARIABLES = Object.keys(docVariables(normalizeInstanceConfig({ title: 'x' })))

describe('documentation index ↔ files', () => {
  it('has one folder per UI language and nothing else', () => {
    expect([...LANGS].sort()).toEqual([...UI_LANGUAGES].sort())
  })

  it('has unique section and group ids, all slug-shaped', () => {
    expect(new Set(IDS).size).toBe(IDS.length)
    expect(new Set(DOC_GROUPS.map((g) => g.id)).size).toBe(DOC_GROUPS.length)
    for (const id of IDS) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })

  it('has a Markdown file in every UI language for every indexed section', () => {
    for (const lang of UI_LANGUAGES) {
      for (const id of IDS) expect(FILES.some((f) => f.lang === lang && f.file === `${id}.md`), `${lang}/${id}.md`).toBe(true)
    }
  })

  it('has no orphan file: every file is an indexed section', () => {
    for (const { lang, file } of FILES) {
      expect(file, `${lang}/${file}`).toMatch(/\.md$/)
      expect(IDS, `${lang}/${file}`).toContain(file.replace(/\.md$/, ''))
    }
  })

  it('titles every group and section in every UI language, with a known icon', () => {
    for (const group of DOC_GROUPS) {
      for (const lang of UI_LANGUAGES) expect(group.title[lang]?.trim(), `${group.id} ${lang}`).toBeTruthy()
      for (const section of group.sections) {
        for (const lang of UI_LANGUAGES) expect(section.title[lang]?.trim(), `${section.id} ${lang}`).toBeTruthy()
        expect(DOC_ICONS, section.id).toHaveProperty(section.icon)
      }
    }
  })
})

describe('documentation files', () => {
  it('start with exactly one page title', () => {
    for (const { lang, file, text } of FILES) {
      const { title, body } = splitTitle(text)
      expect(title, `${lang}/${file}`).toBeTruthy()
      expect(splitTitle(body).title, `${lang}/${file} has a second # title`).toBeNull()
    }
  })

  it('use only placeholders the renderer knows', () => {
    const index = JSON.stringify(DOC_GROUPS)
    for (const name of placeholderNames(index)) expect(KNOWN_VARIABLES, `index.json: {{${name}}}`).toContain(name)
    for (const { lang, file, text } of FILES) {
      for (const name of placeholderNames(text)) expect(KNOWN_VARIABLES, `${lang}/${file}: {{${name}}}`).toContain(name)
    }
  })

  it('link only to sections that exist', () => {
    for (const { lang, file, text } of FILES) {
      for (const [, href] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = sectionFromHref(href)
        if (target) expect(IDS, `${lang}/${file} → ${href}`).toContain(target)
      }
    }
  })

  it('give each heading of a page a distinct anchor', () => {
    for (const { lang, file, text } of FILES) {
      const ids = extractHeadings(text).map((h) => h.id)
      expect(ids.filter((id, i) => ids.indexOf(id) !== i), `${lang}/${file}`).toEqual([])
      for (const id of ids) expect(id, `${lang}/${file}`).not.toBe('')
    }
  })

  it('leave no unconverted v1 HTML or mock placeholder behind', () => {
    for (const { lang, file, text } of FILES) {
      const withoutComments = text.replace(/<!--[\s\S]*?-->/g, '')
      expect(withoutComments, `${lang}/${file}`).not.toMatch(/<\/?(div|span|button|input|table|i|p|ul|li)\b/i)
      expect(withoutComments, `${lang}/${file}`).not.toMatch(/<<<|>>>|MOCK/)
    }
  })
})

describe('doc file table', () => {
  it('maps glob paths to language and section', () => {
    expect(parseDocPath('/src/content/docs/fr/json-schema.md')).toEqual({ lang: 'fr', section: 'json-schema' })
    expect(parseDocPath('../../content/docs/en/introduction.md')).toEqual({ lang: 'en', section: 'introduction' })
    expect(parseDocPath('/src/content/docs/index.json')).toBeNull()
    expect(parseDocPath('/src/content/docs/en/nested/x.md')).toBeNull()
  })

  it('keys loaders by lang/section and skips other paths', () => {
    const load = () => Promise.resolve('')
    const table = buildDocTable({ '/src/content/docs/en/a.md': load, '/src/other/b.md': load })
    expect([...table.keys()]).toEqual(['en/a'])
  })
})
