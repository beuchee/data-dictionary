import { describe, expect, it } from 'vitest'
import { RawNumber, type ConceptSet, type ExpressionItem, type Review } from '@data-dictionary/format'
import { cloneContent } from '@/lib/export/provenance'
import * as v1 from '@/lib/export/v1-fixtures'
import { changedPaths, contentEqual, expressionChange, isReviewsOnlyChange } from './diff'
import { suggestBump } from './semver'

const base = () => cloneContent(v1.conceptSet(155))

const review: Review = {
  reviewId: 9,
  reviewer: { firstName: 'Ada', lastName: 'L' },
  reviewTimestamp: '2026-10-11T10:00:00.000Z',
  status: 'approved',
  comments: 'ok',
  version: '1.0.0',
}

function item(conceptId: number, flags: Partial<ExpressionItem> = {}): ExpressionItem {
  return {
    concept: {
      conceptId,
      conceptName: `c${conceptId}`,
      domainId: 'Measurement',
      vocabularyId: 'LOINC',
      conceptClassId: 'Lab Test',
      standardConcept: 'S',
      conceptCode: String(conceptId),
    },
    isExcluded: false,
    includeDescendants: false,
    includeMapped: false,
    ...flags,
  }
}

function withItems(cs: ConceptSet, items: ExpressionItem[]): ConceptSet {
  return { ...cs, expression: { ...cs.expression, items } }
}

describe('contentEqual / changedPaths', () => {
  it('treats a raw lexeme and its plain number as equal', () => {
    expect(contentEqual({ a: new RawNumber('1.0') }, { a: 1 })).toBe(true)
    expect(contentEqual({ a: new RawNumber('1.0') }, { a: 2 })).toBe(false)
    expect(contentEqual({ a: new RawNumber('1.0') }, { a: '1' })).toBe(false)
  })

  it('treats an undefined key as absent', () => {
    expect(contentEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true)
  })

  it('names the changed fields', () => {
    const a = base()
    const b = cloneContent(a)
    b.metadata.translations.fr.name = 'Autre'
    b.metadata.reviewStatus = 'approved'
    expect(changedPaths(a, b).sort()).toEqual(['metadata.reviewStatus', 'metadata.translations.fr.name'])
    expect(changedPaths(a, cloneContent(a))).toEqual([])
  })

  it('stops at maxDepth', () => {
    const a = base()
    const b = cloneContent(a)
    b.metadata.translations.fr.name = 'Autre'
    expect(changedPaths(a, b, 2)).toEqual(['metadata.translations'])
  })
})

describe('isReviewsOnlyChange', () => {
  it('accepts appended reviews and nothing else', () => {
    const a = base()
    const b = cloneContent(a)
    b.metadata.reviews = [...a.metadata.reviews, review]
    expect(isReviewsOnlyChange(a, b)).toBe(true)
  })

  it('rejects a draft that changes anything besides the reviews', () => {
    const a = base()
    const b = cloneContent(a)
    b.metadata.reviews = [...a.metadata.reviews, review]
    b.modifiedDate = '2099-01-01'
    expect(isReviewsOnlyChange(a, b)).toBe(false)
  })

  it('rejects an edited or removed existing review', () => {
    const a = { ...base(), metadata: { ...base().metadata, reviews: [review] } }
    const edited = cloneContent(a)
    edited.metadata.reviews = [{ ...review, comments: 'changed' }, { ...review, reviewId: 10 }]
    expect(isReviewsOnlyChange(a, edited)).toBe(false)
    const replaced = cloneContent(a)
    replaced.metadata.reviews = [{ ...review, reviewId: 10 }]
    expect(isReviewsOnlyChange(a, replaced)).toBe(false)
  })

  it('rejects no change at all', () => {
    expect(isReviewsOnlyChange(base(), base())).toBe(false)
  })
})

describe('expressionChange and suggestBump', () => {
  const cs = withItems(base(), [item(1), item(2, { includeDescendants: true }), item(3, { isExcluded: true })])

  it('is a patch when the expression is untouched', () => {
    const next = cloneContent(cs)
    next.metadata.translations.en.longDescription = 'new text'
    expect(suggestBump(cs, next)).toBe('patch')
  })

  it('is a minor for an added included concept', () => {
    const next = withItems(cs, [...cs.expression.items, item(4)])
    expect(expressionChange(cs, next)).toMatchObject({ added: [4], removed: [], narrows: false, broadens: true })
    expect(suggestBump(cs, next)).toBe('minor')
  })

  it('is a major for a removed included concept', () => {
    const next = withItems(cs, cs.expression.items.filter((i) => i.concept.conceptId !== 1))
    expect(expressionChange(cs, next)).toMatchObject({ removed: [1], narrows: true })
    expect(suggestBump(cs, next)).toBe('major')
  })

  it('reads removing an exclusion as broadening, adding one as narrowing', () => {
    const lessExcluded = withItems(cs, cs.expression.items.filter((i) => i.concept.conceptId !== 3))
    expect(suggestBump(cs, lessExcluded)).toBe('minor')
    const moreExcluded = withItems(cs, [...cs.expression.items, item(5, { isExcluded: true })])
    expect(suggestBump(cs, moreExcluded)).toBe('major')
  })

  it('follows the direction of flag changes', () => {
    const descendantsOff = withItems(cs, [item(1), item(2), item(3, { isExcluded: true })])
    expect(expressionChange(cs, descendantsOff)).toMatchObject({ modified: [2], narrows: true })
    expect(suggestBump(cs, descendantsOff)).toBe('major')
    const mappedOn = withItems(cs, [item(1, { includeMapped: true }), item(2, { includeDescendants: true }), item(3, { isExcluded: true })])
    expect(suggestBump(cs, mappedOn)).toBe('minor')
    const nowExcluded = withItems(cs, [item(1, { isExcluded: true }), item(2, { includeDescendants: true }), item(3, { isExcluded: true })])
    expect(suggestBump(cs, nowExcluded)).toBe('major')
  })

  it('is a patch for a pure reordering', () => {
    const next = withItems(cs, [...cs.expression.items].reverse())
    expect(suggestBump(cs, next)).toBe('patch')
  })
})
