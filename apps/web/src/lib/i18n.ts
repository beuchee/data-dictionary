// Adapted from linkr@1310cf4a4 apps/web/src/lib/i18n.ts
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

/** UI languages with a locale folder. Content languages come from config.json and may differ. */
export const UI_LANGUAGES = ['en', 'fr'] as const

type LocaleTree = Record<string, unknown>

/** The i18n key prefix of a locale file: `locales/en/concept-sets.json` → `concept_sets`. */
export function namespaceKey(fileName: string): string {
  return fileName.replace(/\.json$/, '').replace(/-/g, '_')
}

/**
 * The i18next resources from the locale files, keyed by their path
 * (`…/locales/<lang>/<namespace>.json`). Each file is one namespace, merged into
 * the single `translation` resource under its `namespaceKey`, so a key reads
 * `t('concept_sets.title')` and separate features edit separate files.
 */
export function buildResources(modules: Record<string, LocaleTree>): Record<string, { translation: LocaleTree }> {
  const resources: Record<string, { translation: LocaleTree }> = {}
  for (const [filePath, content] of Object.entries(modules)) {
    const m = /locales\/([^/]+)\/([^/]+\.json)$/.exec(filePath)
    if (!m) continue
    const [, lang, file] = m
    resources[lang] ??= { translation: {} }
    resources[lang].translation[namespaceKey(file)] = content
  }
  return resources
}

const localeModules = import.meta.glob<LocaleTree>('../locales/*/*.json', { eager: true, import: 'default' })

i18n.use(initReactI18next).init({
  resources: buildResources(localeModules),
  lng: 'en',
  fallbackLng: 'en',
  showSupportNotice: false,
  interpolation: {
    escapeValue: false,
  },
})

/**
 * The language to show: the user's stored choice if this instance offers it,
 * else the instance default, else the first offered language.
 */
export function resolveLanguage(
  stored: string | null | undefined,
  languages: readonly string[],
  defaultLanguage: string,
): string {
  if (stored && languages.includes(stored)) return stored
  if (languages.includes(defaultLanguage)) return defaultLanguage
  return languages[0] ?? 'en'
}

export default i18n
