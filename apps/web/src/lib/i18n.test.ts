import { readFileSync, readdirSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { UI_LANGUAGES, buildResources, namespaceKey, resolveLanguage } from './i18n'

const LOCALES_DIR = path.resolve(__dirname, '../locales')

function flattenKeys(tree: unknown, prefix = ''): string[] {
  if (tree === null || typeof tree !== 'object' || Array.isArray(tree)) return [prefix]
  return Object.entries(tree as Record<string, unknown>).flatMap(([k, v]) =>
    flattenKeys(v, prefix ? `${prefix}.${k}` : k),
  )
}

function readLocale(lang: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const file of readdirSync(path.join(LOCALES_DIR, lang)).filter((f) => f.endsWith('.json'))) {
    out[`../locales/${lang}/${file}`] = JSON.parse(readFileSync(path.join(LOCALES_DIR, lang, file), 'utf-8'))
  }
  return out
}

describe('locale files', () => {
  it('have the same namespace files in every UI language', () => {
    const [first, ...rest] = UI_LANGUAGES.map((lang) => readdirSync(path.join(LOCALES_DIR, lang)).sort())
    for (const files of rest) expect(files).toEqual(first)
  })

  it('have identical key sets in en and fr', () => {
    const en = buildResources(readLocale('en') as Record<string, Record<string, unknown>>).en.translation
    const fr = buildResources(readLocale('fr') as Record<string, Record<string, unknown>>).fr.translation
    const enKeys = flattenKeys(en)
    const frKeys = flattenKeys(fr)
    expect(enKeys.filter((k) => !frKeys.includes(k))).toEqual([])
    expect(frKeys.filter((k) => !enKeys.includes(k))).toEqual([])
  })

  it('never hold an empty string', () => {
    for (const lang of UI_LANGUAGES) {
      const tree = buildResources(readLocale(lang) as Record<string, Record<string, unknown>>)[lang].translation
      const empty = flattenKeys(tree).filter((k) => {
        const value = k.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], tree)
        return value === ''
      })
      expect(empty).toEqual([])
    }
  })
})

describe('buildResources', () => {
  it('nests each file under its namespace key, per language', () => {
    expect(
      buildResources({
        '../locales/en/concept-sets.json': { title: 'Concept sets' },
        '../locales/fr/concept-sets.json': { title: 'Jeux de concepts' },
        '../locales/en/common.json': { save: 'Save' },
        'unrelated/file.json': { x: 1 },
      }),
    ).toEqual({
      en: { translation: { concept_sets: { title: 'Concept sets' }, common: { save: 'Save' } } },
      fr: { translation: { concept_sets: { title: 'Jeux de concepts' } } },
    })
  })

  it('maps kebab-case file names to snake_case keys', () => {
    expect(namespaceKey('dev-tools.json')).toBe('dev_tools')
    expect(namespaceKey('common.json')).toBe('common')
  })
})

describe('resolveLanguage', () => {
  it('keeps a stored language the instance offers', () => {
    expect(resolveLanguage('fr', ['en', 'fr'], 'en')).toBe('fr')
  })

  it('falls back to the instance default for an unknown or missing choice', () => {
    expect(resolveLanguage('de', ['en', 'fr'], 'fr')).toBe('fr')
    expect(resolveLanguage(null, ['en', 'fr'], 'fr')).toBe('fr')
  })

  it('falls back to the first language when the default is not offered', () => {
    expect(resolveLanguage(undefined, ['fr', 'en'], 'de')).toBe('fr')
  })
})
