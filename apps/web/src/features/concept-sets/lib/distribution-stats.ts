// Shapes `metadata.distributionStats` for the Statistics tab. The format is v1's
// (legacy/concept-sets.js, defaultStatsTemplate / renderStatsProfileView):
//   { profiles: [{ name_en, name_fr, description_en, data_types, numeric_data,
//     histogram: [{x, count}], categorical_data: [{value, count, percent}],
//     missing_rate, measurement_frequency: {typical_interval} }],
//     default_profile_en, default_profile_fr }
// Per-language keys are suffixed (`name_fr`) rather than language-first; read
// as they are, with no cross-language fallback.

type Loose = Record<string, unknown>

const isObject = (v: unknown): v is Loose => typeof v === 'object' && v !== null && !Array.isArray(v)

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v)
  return null
}

/** Numeric summary rows, in display order; `percent` values are shown with a %. */
export const NUMERIC_KEYS = ['min', 'p5', 'p25', 'median', 'mean', 'p75', 'p95', 'max', 'sd', 'cv'] as const
export type NumericKey = (typeof NUMERIC_KEYS)[number]

export interface ProfileOption {
  index: number
  /** `name_{lang}`; null when the profile has no name in this language. */
  name: string | null
}

export interface StatsProfiles {
  profiles: ProfileOption[]
  /** The profile named by `default_profile_{lang}`, else the first. */
  defaultIndex: number
}

export interface ProfileView {
  description: string | null
  dataTypes: string[]
  typicalInterval: string | null
  /** Percent. */
  missingRate: number | null
  numeric: { key: NumericKey; value: number }[]
  histogram: { x: string; count: number }[]
  categorical: { value: string; count: number; percent: number | null }[]
  /** Nothing to show in this profile. */
  empty: boolean
}

function profilesOf(stats: unknown): Loose[] {
  if (!isObject(stats) || !Array.isArray(stats.profiles)) return []
  return stats.profiles.filter(isObject)
}

/** The profile selector's options, or null when there are no statistics (null, `{}`, no profile). */
export function statsProfiles(stats: unknown, lang: string): StatsProfiles | null {
  const profiles = profilesOf(stats)
  if (!profiles.length) return null
  const options = profiles.map((p, index) => ({ index, name: text(p[`name_${lang}`]) }))
  const wanted = isObject(stats) ? text(stats[`default_profile_${lang}`]) : null
  const match = wanted ? options.find((o) => o.name === wanted) : undefined
  return { profiles: options, defaultIndex: match?.index ?? 0 }
}

/** What the Statistics tab renders for profile `index`; null when it does not exist. */
export function profileView(stats: unknown, index: number, lang: string): ProfileView | null {
  const profile = profilesOf(stats)[index]
  if (!profile) return null

  const numericData = isObject(profile.numeric_data) ? profile.numeric_data : {}
  const numeric = NUMERIC_KEYS.flatMap((key) => {
    const value = num(numericData[key])
    return value === null ? [] : [{ key, value }]
  })
  // v1 showed the summary only when one of the central values was there.
  const hasSummary = numeric.some((n) => n.key === 'mean' || n.key === 'median' || n.key === 'min')

  const histogram = (Array.isArray(profile.histogram) ? profile.histogram : []).filter(isObject).map((h) => ({
    x: h.x == null ? '' : String(h.x),
    count: num(h.count) ?? 0,
  }))

  const categorical = (Array.isArray(profile.categorical_data) ? profile.categorical_data : [])
    .filter(isObject)
    .map((c) => ({ value: c.value == null ? '' : String(c.value), count: num(c.count) ?? 0, percent: num(c.percent) }))

  const frequency = isObject(profile.measurement_frequency) ? profile.measurement_frequency : {}
  const view: ProfileView = {
    description: text(profile[`description_${lang}`]),
    dataTypes: (Array.isArray(profile.data_types) ? profile.data_types : []).filter((t): t is string => typeof t === 'string' && !!t),
    typicalInterval: text(frequency.typical_interval),
    missingRate: num(profile.missing_rate),
    numeric: hasSummary ? numeric : [],
    histogram,
    categorical,
    empty: false,
  }
  view.empty =
    !view.description &&
    !view.dataTypes.length &&
    !view.typicalInterval &&
    view.missingRate === null &&
    !view.numeric.length &&
    !histogram.length &&
    !categorical.length
  return view
}
