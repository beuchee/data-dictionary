// v1 URL compatibility. v1 was a hash-routed SPA (`#/concept-sets?id=12&tab=review`,
// see legacy/router.js); its links live on in bookmarks, papers and other repos.
// At boot, before the router mounts, such a hash is rewritten to the v2 path.

export interface LegacyRedirect {
  /** v2 path + query string, relative to the app's base (`/concept-sets/12?tab=reviews`). */
  to: string
  /** v1's `?lang=xx`, to apply as the UI language. */
  language?: string
}

// v1 tab names → v2 ones, per page. A value missing from a map is dropped.
const CONCEPT_SET_TABS: Record<string, string> = {
  concepts: 'concepts',
  comments: 'comments',
  statistics: 'statistics',
  review: 'reviews',
  reviews: 'reviews',
}
const PROJECT_TABS: Record<string, string> = { context: 'description', variables: 'concept-sets' }
const SETTINGS_TABS: Record<string, string> = {
  vocabularies: 'vocabularies',
  conversions: 'units',
  units: 'recommended-units',
}
const DEV_TOOLS_SECTIONS = new Set(['sql', 'erd'])
const POSITIVE_INT = /^[1-9][0-9]*$/
const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/

/** v1's parser (router.js `parseHash`): a malformed escape skips the pair. */
function parseQuery(raw: string): Map<string, string> {
  const query = new Map<string, string>()
  for (const pair of raw.split('&')) {
    const [k, v = ''] = pair.split('=')
    try {
      if (k) query.set(decodeURIComponent(k), decodeURIComponent(v))
    } catch {
      // ignored, as in v1
    }
  }
  return query
}

function withQuery(path: string, params: [string, string | undefined][]): string {
  const search = new URLSearchParams()
  for (const [k, v] of params) if (v) search.set(k, v)
  const s = search.toString()
  return s ? `${path}?${s}` : path
}

/**
 * The v2 location for a v1 hash (`#/…`), or null when `hash` is not a v1 route
 * (empty, or a v2 fragment such as the OAuth callback's `#access_token=…`).
 * Unknown v1 paths go to the concept set list, as v1 did.
 */
export function translateLegacyHash(hash: string): LegacyRedirect | null {
  if (!hash.startsWith('#/')) return null
  const raw = hash.slice(1)
  const q = raw.indexOf('?')
  const path = q === -1 ? raw : raw.slice(0, q)
  const query = parseQuery(q === -1 ? '' : raw.slice(q + 1))
  const lang = query.get('lang')
  const language = lang && LANGUAGE.test(lang) ? lang : undefined
  const id = query.get('id') ?? ''

  let to: string
  switch (path) {
    case '/concept-sets': {
      const csId = id || query.get('cs') || ''
      to = POSITIVE_INT.test(csId)
        ? withQuery(`/concept-sets/${csId}`, [
            ['version', query.get('version')],
            ['tab', CONCEPT_SET_TABS[query.get('tab') ?? '']],
          ])
        : withQuery('/concept-sets', [['category', query.get('category')]])
      break
    }
    case '/projects':
      to = POSITIVE_INT.test(id)
        ? withQuery(`/projects/${id}`, [['tab', PROJECT_TABS[query.get('tab') ?? '']]])
        : '/projects'
      break
    case '/mapping': {
      // v1's other tab held browser-only mapping projects; v2 evaluates an imported
      // mapping's coverage there instead.
      const tab = query.get('tab')
      if (tab === 'recommendations') to = '/mapping?tab=recommendations'
      else if (id || tab) to = '/mapping?tab=coverage'
      else to = '/mapping'
      break
    }
    case '/mapping-recommendations':
      to = '/mapping?tab=recommendations'
      break
    case '/settings': {
      const tab = SETTINGS_TABS[query.get('tab') ?? '']
      to = tab ? `/settings/${tab}` : '/settings'
      break
    }
    case '/dev-tools': {
      const section = query.get('section') ?? query.get('tab') ?? ''
      to = DEV_TOOLS_SECTIONS.has(section) && section !== 'sql' ? `/dev-tools?section=${section}` : '/dev-tools'
      break
    }
    case '/documentation':
      to = withQuery('/documentation', [['section', query.get('section')]])
      break
    default:
      to = '/concept-sets'
  }
  return language ? { to, language } : { to }
}

/**
 * Rewrites a v1 hash URL in place (no history entry), before the router reads the
 * location. Returns the language v1's `?lang=` asked for, if any.
 */
export function redirectLegacyHash(baseUrl: string = import.meta.env.BASE_URL): string | undefined {
  const redirect = translateLegacyHash(window.location.hash)
  if (!redirect) return undefined
  window.history.replaceState(window.history.state, '', `${baseUrl.replace(/\/+$/, '')}${redirect.to}`)
  return redirect.language
}
