// Adapted from linkr@1310cf4a4 apps/web/src/lib/i18n.ts
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '@/locales/en.json'
import fr from '@/locales/fr.json'

/** UI languages with a locale file. Content languages come from config.json and may differ. */
export const UI_LANGUAGES = ['en', 'fr'] as const

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fr: { translation: fr },
  },
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
