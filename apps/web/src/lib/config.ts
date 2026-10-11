/** Brand colors as hex strings (`#1f6feb` or `#18e`). Every key is optional. */
export interface BrandColors {
  primary?: string
  secondary?: string
  /** Accepted for compatibility and ignored: `--accent` stays the neutral hover surface. */
  accent?: string
}

/**
 * The per-instance `config.json` at the repo root, shared with v1 (`legacy/`) and the
 * Python scripts. Everything v2 added is optional so an older config keeps working.
 */
export interface InstanceConfig {
  title: string
  languages: string[]
  defaultLanguage: string
  repository?: {
    url?: string
    repo?: string
    branch?: string
    upstream?: string
    upstreamBranch?: string
  }
  organization?: {
    name?: string
    url?: string
  }
  customVocabulary?: {
    id?: string
    codePrefix?: string
  }
  branding?: {
    /** Path relative to the app's base URL. */
    logo?: string
    favicon?: string
    logoAlt?: string
    appName?: string
    colors?: BrandColors
    /** Dark-mode overrides; a color missing here is derived from `colors`. */
    darkColors?: BrandColors
    font?: string
  }
  tabs?: {
    showProjects?: boolean
    showMappingRecommendations?: boolean
  }
  access?: {
    /** Server mode: whether pages are readable without logging in. Defaults to true. */
    anonymousRead?: boolean
  }
}

export function appName(config: InstanceConfig): string {
  return config.branding?.appName?.trim() || config.title
}

/** A branding path from the config, resolved against the app's base URL. */
export function assetUrl(file: string | undefined, baseUrl: string = import.meta.env.BASE_URL): string | null {
  if (!file?.trim()) return null
  if (/^(https?:|data:)/.test(file)) return file
  return `${baseUrl.replace(/\/?$/, '/')}${file.replace(/^\/+/, '')}`
}

export async function loadInstanceConfig(): Promise<InstanceConfig> {
  const res = await fetch(`${import.meta.env.BASE_URL}config.json`, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`config.json: HTTP ${res.status}`)
  const raw = (await res.json()) as Partial<InstanceConfig>
  const languages = Array.isArray(raw.languages) && raw.languages.length > 0 ? raw.languages : ['en']
  return {
    ...raw,
    title: raw.title ?? 'Data Dictionary',
    languages,
    defaultLanguage:
      raw.defaultLanguage && languages.includes(raw.defaultLanguage) ? raw.defaultLanguage : languages[0],
  }
}
