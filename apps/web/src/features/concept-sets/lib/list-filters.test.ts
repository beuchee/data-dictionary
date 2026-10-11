import { describe, expect, it } from 'vitest'
import type { ConceptSetSummary } from '@/lib/data'
import {
  EMPTY_FILTERS,
  applyListFilters,
  categoryCounts,
  parseListFilters,
  selectedStatuses,
  sortCategories,
  subcategoryOptions,
  toRow,
  writeListFilters,
  type ConceptSetRow,
  type ListFilters,
} from './list-filters'

function summary(over: Partial<ConceptSetSummary> = {}): ConceptSetSummary {
  return {
    id: 1,
    version: '1.0.0',
    uniqueId: null,
    translations: {
      en: { name: 'Heart rate', category: 'Vitals', subcategory: 'Cardio', shortDescription: 'Beats per minute' },
      fr: { name: 'Fréquence cardiaque', category: 'Constantes', subcategory: null, shortDescription: null },
    },
    reviewStatus: 'approved',
    organization: { created: { name: 'A' }, current: { name: 'B' } },
    itemCount: 2,
    resolvedCount: 5,
    modifiedDate: '2026-01-02',
    modifiedBy: 'Jane',
    ...over,
  }
}

function row(over: Partial<ConceptSetRow>): ConceptSetRow {
  return {
    id: 1,
    name: '',
    category: '',
    subcategory: '',
    shortDescription: '',
    reviewStatus: 'approved',
    version: '1.0.0',
    itemCount: 0,
    resolvedCount: null,
    organization: '',
    modifiedDate: '',
    ...over,
  }
}

const filters = (over: Partial<ListFilters>): ListFilters => ({ ...EMPTY_FILTERS, ...over })

describe('toRow', () => {
  it('reads the requested language and the current organization', () => {
    const r = toRow(summary(), 'fr')
    expect(r).toMatchObject({ name: 'Fréquence cardiaque', category: 'Constantes', subcategory: '', organization: 'B' })
  })

  it('never falls back to another language', () => {
    const r = toRow(summary(), 'de')
    expect(r).toMatchObject({ name: '', category: '', subcategory: '', shortDescription: '' })
  })

  it('does not read inherited keys as languages', () => {
    expect(toRow(summary(), 'constructor').name).toBe('')
  })

  it('copes with a set without organization', () => {
    expect(toRow(summary({ organization: null }), 'en').organization).toBe('')
  })
})

describe('URL state', () => {
  it('round-trips every filter', () => {
    const f = filters({
      q: 'heart',
      categories: ['Vitals', 'Labs'],
      subcategories: ['Cardio'],
      statuses: ['approved', 'draft'],
      organizations: ['INDICATE'],
      description: 'bpm',
    })
    expect(parseListFilters(writeListFilters(f))).toEqual(f)
  })

  it('leaves empty filters out of the URL', () => {
    expect(writeListFilters(EMPTY_FILTERS).toString()).toBe('')
  })

  it('reads v1 links (?category=A,B)', () => {
    expect(parseListFilters(new URLSearchParams('category=Conditions,Vitals')).categories).toEqual(['Conditions', 'Vitals'])
  })

  it('tells the default status view (no param) from "every status" (empty param)', () => {
    expect(parseListFilters(new URLSearchParams('')).statuses).toBeNull()
    expect(parseListFilters(new URLSearchParams('status=')).statuses).toEqual([])
    expect(writeListFilters(filters({ statuses: [] })).toString()).toBe('status=')
  })

  it('drops unknown or spaced status values', () => {
    expect(parseListFilters(new URLSearchParams('status=approved,pending review,bogus')).statuses).toEqual(['approved'])
  })

  it('shows every status but deprecated as selected by default', () => {
    expect(selectedStatuses(EMPTY_FILTERS)).toEqual(['draft', 'pending_review', 'approved', 'needs_revision'])
  })
})

describe('categories', () => {
  it('sorts alphabetically with Other / Autres last', () => {
    expect(sortCategories(['Other', 'Vitals', 'Autres', 'Labs'])).toEqual(['Labs', 'Vitals', 'Autres', 'Other'])
  })

  it('counts sets per category, skipping empty ones', () => {
    const rows = [row({ category: 'B' }), row({ category: 'A' }), row({ category: 'B' }), row({ category: '' })]
    expect(categoryCounts(rows)).toEqual([
      { category: 'A', count: 1 },
      { category: 'B', count: 2 },
    ])
  })

  it('offers the subcategories of the selected categories', () => {
    const rows = [row({ category: 'A', subcategory: 'a1' }), row({ category: 'B', subcategory: 'b1' })]
    expect(subcategoryOptions(rows, [])).toEqual(['a1', 'b1'])
    expect(subcategoryOptions(rows, ['B'])).toEqual(['b1'])
  })
})

describe('applyListFilters', () => {
  const rows = [
    row({ id: 1, name: 'Heart rate', category: 'Vitals', subcategory: 'Cardio', organization: 'X' }),
    row({ id: 2, name: 'Creatinine', category: 'Labs', subcategory: 'Renal', shortDescription: 'Serum creatinine' }),
    row({ id: 3, name: 'Old heart rate', category: 'Vitals', reviewStatus: 'deprecated' }),
    row({ id: 4, name: 'Untracked', category: 'Labs', reviewStatus: null }),
    row({ id: 22, name: 'Glucose', category: 'Labs', reviewStatus: 'draft' }),
  ]
  const ids = (f: Partial<ListFilters>) => applyListFilters(rows, filters(f)).map((r) => r.id)

  it('hides deprecated sets by default, but keeps sets without status', () => {
    expect(ids({})).toEqual([1, 2, 4, 22])
  })

  it('shows every status with an empty status filter, and only the listed ones otherwise', () => {
    expect(ids({ statuses: [] })).toEqual([1, 2, 3, 4, 22])
    expect(ids({ statuses: ['deprecated', 'draft'] })).toEqual([3, 22])
  })

  it('filters by category, subcategory, organization and description', () => {
    expect(ids({ categories: ['Labs'] })).toEqual([2, 4, 22])
    expect(ids({ subcategories: ['Renal'] })).toEqual([2])
    expect(ids({ organizations: ['X'] })).toEqual([1])
    expect(ids({ description: 'SERUM' })).toEqual([2])
  })

  it('ignores a subcategory outside the selected categories', () => {
    expect(ids({ categories: ['Labs'], subcategories: ['Cardio'] })).toEqual([2, 4, 22])
  })

  it('fuzzy-searches the name, best match first', () => {
    expect(ids({ q: 'heart rate', statuses: [] })).toEqual([1, 3])
    expect(ids({ q: 'creatinin' })).toEqual([2])
  })

  it('finds a set by its id', () => {
    expect(ids({ q: '22' })).toEqual([22])
  })
})
