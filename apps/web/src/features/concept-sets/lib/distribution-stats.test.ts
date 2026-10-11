import { describe, expect, it } from 'vitest'
import { profileView, statsProfiles } from './distribution-stats'

// v1's defaultStatsTemplate (legacy/concept-sets.js), filled in, plus a second profile.
const STATS = {
  profiles: [
    {
      name_en: 'All patients',
      name_fr: 'Tous les patients',
      description_en: 'Default profile for all patients',
      description_fr: 'Profil par défaut pour tous les patients',
      data_types: ['numeric'],
      numeric_data: { min: 30, max: 220, mean: 84.2, median: 82, sd: 17.5, cv: 20.8, p5: 58, p25: 72, p75: 95, p95: 115 },
      histogram: [
        { x: '30-60', count: 1200 },
        { x: '60-90', count: 54000 },
        { x: '90-120', count: 21000 },
      ],
      categorical_data: [],
      missing_rate: 2.5,
      measurement_frequency: { typical_interval: '1 hour' },
    },
    {
      name_en: 'ICU',
      name_fr: 'Réanimation',
      data_types: [],
      numeric_data: { min: null, max: null, mean: null, median: null, sd: null, cv: null, p5: null, p25: null, p75: null, p95: null },
      histogram: [],
      categorical_data: [
        { value: 'Positive', count: 40, percent: 40 },
        { value: 'Negative', count: 60, percent: '60' },
      ],
      measurement_frequency: { typical_interval: null },
    },
  ],
  default_profile_en: 'All patients',
  default_profile_fr: 'Réanimation',
}

const TEMPLATE = {
  profiles: [
    {
      name_en: 'All patients',
      name_fr: 'Tous les patients',
      data_types: [],
      numeric_data: { min: null, max: null, mean: null, median: null, sd: null, cv: null, p5: null, p25: null, p75: null, p95: null },
      histogram: [],
      categorical_data: [],
      measurement_frequency: { typical_interval: null },
    },
  ],
  default_profile_en: 'All patients',
  default_profile_fr: 'Tous les patients',
}

describe('statsProfiles', () => {
  it('is null without statistics (null, {}, no profiles, garbage)', () => {
    expect(statsProfiles(null, 'en')).toBeNull()
    expect(statsProfiles({}, 'en')).toBeNull()
    expect(statsProfiles({ profiles: [] }, 'en')).toBeNull()
    expect(statsProfiles({ profiles: 'x' }, 'en')).toBeNull()
    expect(statsProfiles([1, 2], 'en')).toBeNull()
  })

  it('names profiles in the requested language and picks its default', () => {
    expect(statsProfiles(STATS, 'en')).toEqual({
      profiles: [
        { index: 0, name: 'All patients' },
        { index: 1, name: 'ICU' },
      ],
      defaultIndex: 0,
    })
    expect(statsProfiles(STATS, 'fr')?.defaultIndex).toBe(1)
  })

  it('does not fall back to English for a missing language', () => {
    expect(statsProfiles(STATS, 'de')).toEqual({
      profiles: [
        { index: 0, name: null },
        { index: 1, name: null },
      ],
      defaultIndex: 0,
    })
  })
})

describe('profileView', () => {
  it('shapes a numeric profile', () => {
    const view = profileView(STATS, 0, 'en')!
    expect(view.description).toBe('Default profile for all patients')
    expect(view.dataTypes).toEqual(['numeric'])
    expect(view.typicalInterval).toBe('1 hour')
    expect(view.missingRate).toBe(2.5)
    expect(view.numeric.map((n) => n.key)).toEqual(['min', 'p5', 'p25', 'median', 'mean', 'p75', 'p95', 'max', 'sd', 'cv'])
    expect(view.histogram).toEqual([
      { x: '30-60', count: 1200 },
      { x: '60-90', count: 54000 },
      { x: '90-120', count: 21000 },
    ])
    expect(view.empty).toBe(false)
  })

  it('shapes a categorical profile, coercing numeric strings', () => {
    const view = profileView(STATS, 1, 'en')!
    expect(view.numeric).toEqual([])
    expect(view.description).toBeNull()
    expect(view.categorical).toEqual([
      { value: 'Positive', count: 40, percent: 40 },
      { value: 'Negative', count: 60, percent: 60 },
    ])
  })

  it('reads the empty v1 template as an empty profile', () => {
    expect(profileView(TEMPLATE, 0, 'en')?.empty).toBe(true)
  })

  it('hides a summary holding only a spread (no min / mean / median), as v1', () => {
    const stats = { profiles: [{ numeric_data: { sd: 3, p95: 10 } }] }
    expect(profileView(stats, 0, 'en')?.numeric).toEqual([])
  })

  it('is null for a profile that does not exist', () => {
    expect(profileView(STATS, 5, 'en')).toBeNull()
    expect(profileView(null, 0, 'en')).toBeNull()
  })

  it('survives malformed entries', () => {
    const stats = { profiles: [{ histogram: [null, { x: 1, count: 'abc' }], categorical_data: 'x', data_types: [1, 'a'] }] }
    const view = profileView(stats, 0, 'en')!
    expect(view.histogram).toEqual([{ x: '1', count: 0 }])
    expect(view.categorical).toEqual([])
    expect(view.dataTypes).toEqual(['a'])
  })
})
