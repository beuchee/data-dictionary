// The Branding settings as pure functions: config.json ⇄ form, the color
// preview (lib/theme.ts), and the image checks mirrored from the API
// (apps/api/app/services/branding_assets.py).
import {
  MIN_CONTRAST,
  contrastRatio,
  deriveDarkVariant,
  oklchToRgb,
  parseHex,
  readableForeground,
  themeVariables,
  type ThemeVariables,
} from '@/lib/theme'
import type { Config } from '@data-dictionary/format'

/** The reserved key of a config draft carrying the branding images (never written to config.json). */
export const ASSETS_KEY = '$assets'

export type AssetKind = 'logo' | 'favicon'

export interface AssetUpload {
  filename: string
  /** A `data:` URL (the API accepts it as well as bare base64). */
  base64: string
}

/** A config draft's content: config.json plus, optionally, images to commit next to it. */
export type ConfigDraftContent = Config & { [ASSETS_KEY]?: Partial<Record<AssetKind, AssetUpload>> }

export interface BrandingForm {
  title: string
  appName: string
  logoAlt: string
  primary: string
  secondary: string
  languages: string[]
  defaultLanguage: string
  organizationName: string
  organizationUrl: string
  vocabularyId: string
  vocabularyPrefix: string
  showProjects: boolean
  showMappingRecommendations: boolean
  anonymousRead: boolean
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export function brandingForm(config: Config): BrandingForm {
  const languages = Array.isArray(config.languages) && config.languages.length > 0 ? [...config.languages] : ['en']
  return {
    title: str(config.title),
    appName: str(config.branding?.appName),
    logoAlt: str(config.branding?.logoAlt),
    primary: str(config.branding?.colors?.primary),
    secondary: str(config.branding?.colors?.secondary),
    languages,
    defaultLanguage: languages.includes(str(config.defaultLanguage)) ? str(config.defaultLanguage) : languages[0],
    organizationName: str(config.organization?.name),
    organizationUrl: str(config.organization?.url),
    vocabularyId: str(config.customVocabulary?.id),
    vocabularyPrefix: str(config.customVocabulary?.codePrefix),
    showProjects: config.tabs?.showProjects !== false,
    showMappingRecommendations: config.tabs?.showMappingRecommendations !== false,
    anonymousRead: config.access?.anonymousRead !== false,
  }
}

export type BrandingFormError =
  | 'title_required'
  | 'languages_required'
  | 'invalid_language'
  | 'invalid_primary'
  | 'invalid_secondary'
  | 'invalid_organization_url'

const LANG_KEY = /^[a-z]{2,3}(-[A-Za-z0-9]{1,8})*$/
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export function isLanguageCode(code: string): boolean {
  return LANG_KEY.test(code)
}

export function validateBrandingForm(form: BrandingForm): BrandingFormError | null {
  if (!form.title.trim()) return 'title_required'
  if (form.languages.length === 0) return 'languages_required'
  if (!form.languages.every(isLanguageCode)) return 'invalid_language'
  if (form.primary.trim() && !HEX.test(form.primary.trim())) return 'invalid_primary'
  if (form.secondary.trim() && !HEX.test(form.secondary.trim())) return 'invalid_secondary'
  const url = form.organizationUrl.trim()
  if (url && !/^https?:\/\/\S+$/.test(url)) return 'invalid_organization_url'
  return null
}

type Obj = Record<string, unknown>

/**
 * `obj` with `key` set to `value` (in place when the key exists, appended
 * otherwise), or removed when `value` is undefined. Never mutates `obj`.
 */
function withKey(obj: Obj | undefined, key: string, value: unknown): Obj {
  const out: Obj = { ...(obj ?? {}) }
  if (value === undefined) delete out[key]
  else out[key] = value
  return out
}

/** `obj` without empty keys; undefined when nothing is left (the key then goes away). */
function orUndefined(obj: Obj): Obj | undefined {
  return Object.keys(obj).length > 0 ? obj : undefined
}

const opt = (s: string): string | undefined => (s.trim() ? s.trim() : undefined)

/**
 * `config` with the form applied. Every key the form does not own (repository,
 * logo / favicon paths, darkColors, font, unknown keys) is kept, and key order
 * is preserved; an emptied optional field drops its key rather than writing "".
 * Defaults (tabs shown, anonymous read on) are written only when the key was
 * already there or the value differs from the default.
 */
export function applyBrandingForm(config: Config, form: BrandingForm): Config {
  let out: Obj = { ...config }
  out = withKey(out, 'title', form.title.trim())
  out = withKey(out, 'languages', [...form.languages])
  out = withKey(out, 'defaultLanguage', form.languages.includes(form.defaultLanguage) ? form.defaultLanguage : form.languages[0])

  const organization = withKey(withKey(config.organization, 'name', opt(form.organizationName)), 'url', opt(form.organizationUrl))
  out = withKey(out, 'organization', orUndefined(organization))

  const vocabulary = withKey(withKey(config.customVocabulary, 'id', opt(form.vocabularyId)), 'codePrefix', opt(form.vocabularyPrefix))
  out = withKey(out, 'customVocabulary', orUndefined(vocabulary))

  const colors = withKey(withKey(config.branding?.colors, 'primary', opt(form.primary)), 'secondary', opt(form.secondary))
  let branding = withKey(config.branding, 'appName', opt(form.appName))
  branding = withKey(branding, 'logoAlt', opt(form.logoAlt))
  branding = withKey(branding, 'colors', orUndefined(colors))
  out = withKey(out, 'branding', orUndefined(branding))

  const flag = (section: Obj | undefined, key: string, value: boolean, fallback: boolean) =>
    section && key in section ? withKey(section, key, value) : value === fallback ? section : withKey(section, key, value)
  let tabs = flag(config.tabs, 'showProjects', form.showProjects, true)
  tabs = flag(tabs, 'showMappingRecommendations', form.showMappingRecommendations, true)
  out = withKey(out, 'tabs', tabs === undefined ? undefined : orUndefined(tabs))
  const access = flag(config.access, 'anonymousRead', form.anonymousRead, true)
  out = withKey(out, 'access', access === undefined ? undefined : orUndefined(access))
  return out as Config
}

// ---------------------------------------------------------------------------
// Color preview
// ---------------------------------------------------------------------------

export interface ContrastCheck {
  /** Brand color against its derived foreground (buttons, badges). */
  onColor: number
  /** Dark mode: the derived variant against the dark background (links, rings). */
  darkOnBackground: number
  passes: boolean
}

// index.css `.dark --background` (as in lib/theme.ts).
const DARK_BACKGROUND = oklchToRgb({ l: 0.129, c: 0.042, h: 264.695 })

/** WCAG contrast of a brand color as the app will use it; null for an invalid hex. */
export function contrastCheck(hex: string): ContrastCheck | null {
  const rgb = parseHex(hex)
  if (!rgb) return null
  const onColor = contrastRatio(rgb, readableForeground(rgb).rgb)
  const dark = oklchToRgb(deriveDarkVariant(rgb))
  const darkOnBackground = contrastRatio(dark, DARK_BACKGROUND)
  return { onColor, darkOnBackground, passes: onColor >= MIN_CONTRAST && darkOnBackground >= MIN_CONTRAST }
}

/** The CSS variables the colors produce, for a preview scoped to one element. */
export function previewVariables(primary: string, secondary: string): ThemeVariables {
  return themeVariables({ colors: { primary: primary.trim() || undefined, secondary: secondary.trim() || undefined } })
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export const MAX_ASSET_BYTES: Record<AssetKind, number> = { logo: 1024 * 1024, favicon: 256 * 1024 }
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/svg+xml']

export type AssetError = 'too_large' | 'unsupported_type' | 'empty'

/** The browser-side check before upload; the API checks the bytes again. */
export function checkAssetFile(kind: AssetKind, file: { name: string; type: string; size: number }): AssetError | null {
  if (file.size === 0) return 'empty'
  if (file.size > MAX_ASSET_BYTES[kind]) return 'too_large'
  const byExtension = /\.(png|jpe?g|gif|webp|ico|svg)$/i.test(file.name)
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type) && !(file.type === '' && byExtension)) return 'unsupported_type'
  return null
}

/** The draft content: the config, plus the uploaded images under `$assets` when there are any. */
export function configDraftContent(config: Config, uploads: Partial<Record<AssetKind, AssetUpload>>): ConfigDraftContent {
  const entries = Object.entries(uploads).filter(([, v]) => v)
  if (entries.length === 0) {
    const { [ASSETS_KEY]: _dropped, ...rest } = config as ConfigDraftContent
    return rest as ConfigDraftContent
  }
  return { ...config, [ASSETS_KEY]: Object.fromEntries(entries) }
}

/** Splits a draft's content back into the config and its pending uploads. */
export function splitConfigDraft(content: ConfigDraftContent): { config: Config; uploads: Partial<Record<AssetKind, AssetUpload>> } {
  const { [ASSETS_KEY]: uploads, ...config } = content
  return { config: config as Config, uploads: uploads ?? {} }
}
