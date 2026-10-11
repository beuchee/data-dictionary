import { describe, expect, it } from 'vitest'
import { RawNumber, serialize, validate } from '@data-dictionary/format'
import { conceptSetSummary } from '@/lib/data/catalog'
import { cloneContent } from '@/lib/export/provenance'
import * as v1 from '@/lib/export/v1-fixtures'
import {
  appendReview,
  applyMetadata,
  applyVersionBump,
  categoryOptions,
  counterpart,
  metadataFields,
  newConceptSet,
  parseStatistics,
  statisticsEditorText,
  statisticsTemplateText,
  withLongDescription,
} from './editing'

const person = { firstName: 'Ada', lastName: 'Lovelace', affiliation: 'X', profession: 'MD', orcid: '0000-0002-1825-0097' }

describe('metadata', () => {
  it('writes each language, empty fields as null, keeping the long description', () => {
    const cs = v1.conceptSet(1)
    const long = cs.metadata.translations.en.longDescription
    const out = applyMetadata(cs, {
      en: { name: ' Heart rate ', category: 'Vitals', subcategory: '', shortDescription: 'Beats\nper   minute ' },
      de: { name: '', category: '', subcategory: '', shortDescription: '' },
    })
    expect(out.metadata.translations.en).toMatchObject({ name: 'Heart rate', category: 'Vitals', subcategory: null, shortDescription: 'Beats per minute' })
    expect(out.metadata.translations.en.longDescription).toBe(long)
    expect('de' in out.metadata.translations).toBe(false)
    expect(cs.metadata.translations.en.name).not.toBe('Heart rate')
  })

  it('reads a missing language as empty fields', () => {
    expect(metadataFields(v1.conceptSet(1), 'de')).toEqual({ name: '', category: '', subcategory: '', shortDescription: '' })
  })

  const summaries = [
    { en: ['Laboratory', 'Chemistry'], fr: ['Laboratoire', 'Biochimie'] },
    { en: ['Laboratory', 'Hematology'], fr: ['Laboratoire', 'Hématologie'] },
    { en: ['Laboratory', 'Chemistry'], fr: ['Biologie', 'Biochimie'] },
    { en: ['Vitals', ''], fr: ['', ''] },
  ].map((t, i) =>
    conceptSetSummary(
      {
        ...v1.conceptSet(1),
        id: i + 1,
        metadata: {
          ...v1.conceptSet(1).metadata,
          translations: {
            en: { category: t.en[0], subcategory: t.en[1] },
            fr: { category: t.fr[0] || null, subcategory: t.fr[1] || null },
          },
        },
      },
      null,
    ),
  )

  it('suggests categories and their subcategories per language', () => {
    const en = categoryOptions(summaries, 'en')
    expect(en.categories).toEqual(['Laboratory', 'Vitals'])
    expect(en.subcategories.get('Laboratory')).toEqual(['Chemistry', 'Hematology'])
    expect(en.subcategories.get('Vitals')).toEqual([])
    expect(categoryOptions(summaries, 'de').categories).toEqual([])
  })

  it('pairs a value with its most common translation', () => {
    expect(counterpart(summaries, 'category', 'en', 'fr', 'Laboratory')).toBe('Laboratoire')
    expect(counterpart(summaries, 'subcategory', 'en', 'fr', 'Chemistry')).toBe('Biochimie')
    expect(counterpart(summaries, 'category', 'en', 'fr', 'Vitals')).toBeNull()
    expect(counterpart(summaries, 'category', 'en', 'fr', '')).toBeNull()
  })
})

describe('newConceptSet', () => {
  const created = newConceptSet({
    id: 401,
    values: {
      en: { name: 'Heart rate', category: 'Vitals', subcategory: '', shortDescription: 'Beats per minute' },
      fr: { name: 'Fréquence cardiaque', category: 'Constantes', subcategory: '', shortDescription: '' },
    },
    person,
    authorName: 'Ada Lovelace',
    organization: { name: 'Org', url: 'https://org' },
    repoUrl: 'https://github.com/o/r',
    toolTag: 'tool',
    date: '2026-10-11',
    uniqueId: '123e4567-e89b-42d3-a456-426614174000',
  })

  it('is a valid concept set file in the canonical field order', () => {
    expect(validate('concept-set', created)).toMatchObject({ valid: true })
    expect(Object.keys(created)).toEqual(Object.keys(v1.conceptSet(1)))
    expect(Object.keys(created.metadata)).toEqual([
      'uniqueId', 'organization', 'sourceRepo', 'reviewStatus', 'origin', 'translations', 'createdByDetails', 'reviews', 'versions', 'distributionStats',
    ])
  })

  it('mirrors English at the root and starts as a draft owned by this organization', () => {
    expect(created).toMatchObject({ id: 401, name: 'Heart rate', description: 'Beats per minute', version: '1.0.0', createdBy: 'Ada Lovelace' })
    expect(created.metadata).toMatchObject({ reviewStatus: 'draft', origin: null, sourceRepo: 'https://github.com/o/r' })
    expect(created.metadata.organization).toEqual({ created: { name: 'Org', url: 'https://org' }, current: { name: 'Org', url: 'https://org' } })
    expect(created.metadata.translations.fr.shortDescription).toBeNull()
    expect(created.expression.items).toEqual([])
  })
})

describe('applyVersionBump', () => {
  const bump = { version: '1.1.0', date: '2026-10-11', author: 'Ada', message: ' Added LOINC codes ' }

  it('appends an entry and moves the version', () => {
    const cs = { ...v1.conceptSet(1), version: '1.0.0' }
    const out = applyVersionBump(cs, '1.0.0', bump)
    expect(out.version).toBe('1.1.0')
    expect(out.metadata.versions.at(-1)).toEqual({ version: '1.1.0', date: '2026-10-11', author: 'Ada', message: 'Added LOINC codes' })
    expect(out.metadata.versions.length).toBe(cs.metadata.versions.length + 1)
  })

  it('replaces the entry of a version bumped earlier in the same draft', () => {
    const cs = { ...v1.conceptSet(1), version: '1.0.0' }
    const once = applyVersionBump(cs, '1.0.0', bump)
    const twice = applyVersionBump(once, '1.0.0', { ...bump, version: '2.0.0', message: 'Removed codes' })
    expect(twice.version).toBe('2.0.0')
    expect(twice.metadata.versions.length).toBe(cs.metadata.versions.length + 1)
    expect(twice.metadata.versions.at(-1)?.version).toBe('2.0.0')
  })
})

describe('appendReview', () => {
  const cs = v1.conceptSet(1)
  const at = '2026-10-11T10:00:00.000Z'

  it('numbers the review after the existing ones, for the current version', () => {
    const withOne = { ...cs, metadata: { ...cs.metadata, reviews: [{ reviewId: 4, reviewer: {}, version: '1.0.0' }] } }
    const out = appendReview(withOne, { status: 'approved', comments: ' ok ', reviewer: person, timestamp: at })
    expect(out.metadata.reviews[1]).toEqual({
      reviewId: 5,
      reviewer: person,
      reviewTimestamp: at,
      comments: 'ok',
      version: cs.version,
      status: 'approved',
    })
  })

  it('stores a plain comment without any status key', () => {
    const out = appendReview(cs, { status: null, comments: 'question', reviewer: person, timestamp: at })
    expect('status' in out.metadata.reviews.at(-1)!).toBe(false)
    expect(out.metadata.reviews.at(-1)?.reviewId).toBe(1)
  })
})

describe('statistics', () => {
  it('starts from the template when the set has none', () => {
    expect(statisticsEditorText(v1.conceptSet(1))).toBe(statisticsTemplateText())
    expect(JSON.parse(statisticsTemplateText()).profiles[0].name_fr).toBe('Tous les patients')
  })

  it('parses the editor text keeping lexemes, and refuses non-objects', () => {
    const parsed = parseStatistics('{"mean": 1.0}')
    expect(parsed.ok && serialize(parsed.value)).toBe('{\n  "mean": 1.0\n}\n')
    expect(parseStatistics('  ')).toEqual({ ok: true, value: null })
    expect(parseStatistics('[1]')).toEqual({ ok: false, error: 'not_object' })
    expect(parseStatistics('{"a": ').ok).toBe(false)
  })

  it('round-trips existing statistics', () => {
    const cs = cloneContent(v1.conceptSet(1))
    cs.metadata.distributionStats = { mean: new RawNumber('1.0') }
    expect(statisticsEditorText(cs)).toBe('{\n  "mean": 1.0\n}')
  })
})

describe('withLongDescription', () => {
  it('sets, clears and leaves absent languages alone', () => {
    const cs = v1.conceptSet(1)
    expect(withLongDescription(cs, 'en', '# Title\n\n').metadata.translations.en.longDescription).toBe('# Title')
    expect(withLongDescription(cs, 'en', '   ').metadata.translations.en.longDescription).toBeNull()
    expect('de' in withLongDescription(cs, 'de', '').metadata.translations).toBe(false)
    expect(withLongDescription(cs, 'de', 'Hallo').metadata.translations.de).toEqual({ longDescription: 'Hallo' })
  })
})
