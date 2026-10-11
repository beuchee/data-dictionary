import { describe, expect, it } from 'vitest'
import {
  CUSTOM_CONCEPT_BASE,
  addItems,
  customConceptErrors,
  customConceptItem,
  customIds,
  customVocabulary,
  expressionKey,
  itemFromConcept,
  nextCustomConceptId,
  normalizeVocabDate,
  parseAtlasExpression,
  removeItems,
  sameExpression,
  setItemFlag,
  updateCustomConcept,
} from './expression'
import type { OmopConcept } from '@/lib/vocabulary'
import type { ExpressionItem } from '@data-dictionary/format'

const concept = (id: number, extra: Partial<OmopConcept> = {}): OmopConcept => ({
  conceptId: id,
  conceptName: `Concept ${id}`,
  domainId: 'Measurement',
  vocabularyId: 'LOINC',
  conceptClassId: 'Lab Test',
  standardConcept: 'S',
  conceptCode: `${id}-1`,
  validStartDate: '1970-01-01',
  validEndDate: '2099-12-31',
  invalidReason: null,
  ...extra,
})

describe('itemFromConcept', () => {
  it('copies the vocabulary row in the example file’s field order', () => {
    const item = itemFromConcept(concept(3027018, { conceptName: 'Heart rate', conceptClassId: 'Clinical Observation', conceptCode: '8867-4' }))
    expect(JSON.stringify(item)).toBe(
      JSON.stringify({
        concept: {
          conceptId: 3027018,
          conceptName: 'Heart rate',
          domainId: 'Measurement',
          vocabularyId: 'LOINC',
          conceptClassId: 'Clinical Observation',
          standardConcept: 'S',
          standardConceptCaption: 'Standard',
          conceptCode: '8867-4',
          validStartDate: '1970-01-01',
          validEndDate: '2099-12-31',
          invalidReason: null,
          invalidReasonCaption: 'Valid',
        },
        isExcluded: false,
        includeDescendants: false,
        includeMapped: false,
      }),
    )
  })

  it('writes null for a non-standard concept, never a Classification caption on it', () => {
    const nonStandard = itemFromConcept(concept(1, { standardConcept: null }))
    expect(nonStandard.concept.standardConcept).toBeNull()
    expect(nonStandard.concept.standardConceptCaption).toBe('Non-Standard')
    const classification = itemFromConcept(concept(2, { standardConcept: 'C' }))
    expect(classification.concept).toMatchObject({ standardConcept: 'C', standardConceptCaption: 'Classification' })
  })

  it('keeps the vocabulary’s validity and flags', () => {
    const item = itemFromConcept(concept(1, { invalidReason: 'U', validStartDate: '20010101' }), {
      isExcluded: true,
      includeDescendants: true,
      includeMapped: false,
    })
    expect(item.concept).toMatchObject({ invalidReason: 'U', invalidReasonCaption: 'Invalid', validStartDate: '2001-01-01' })
    expect(item).toMatchObject({ isExcluded: true, includeDescendants: true, includeMapped: false })
  })
})

describe('normalizeVocabDate', () => {
  it.each([
    ['20240131', '2024-01-31'],
    ['2024-01-31', '2024-01-31'],
    ['2024-01-31T00:00:00.000Z', '2024-01-31'],
    ['', ''],
    [null, ''],
    ['31/01/2024', '31/01/2024'],
  ])('%s → %s', (input, out) => expect(normalizeVocabDate(input)).toBe(out))
})

describe('expression operations', () => {
  const items = [itemFromConcept(concept(1)), itemFromConcept(concept(2)), itemFromConcept(concept(3))]

  it('adds new concepts and skips those already present', () => {
    const r = addItems(items, [itemFromConcept(concept(2)), itemFromConcept(concept(4)), itemFromConcept(concept(4))])
    expect(r.items.map((i) => i.concept.conceptId)).toEqual([1, 2, 3, 4])
    expect([r.added, r.skipped]).toEqual([1, 2])
  })

  it('toggles one flag of one row', () => {
    const out = setItemFlag(items, 1, 'includeDescendants', true)
    expect(out.map((i) => i.includeDescendants)).toEqual([false, true, false])
    expect(items[1].includeDescendants).toBe(false)
  })

  it('removes the selected rows', () => {
    expect(removeItems(items, [2, 0]).map((i) => i.concept.conceptId)).toEqual([2])
    expect(removeItems(items, []).length).toBe(3)
  })

  it('keys the expression on what resolution reads', () => {
    const renamed = items.map((i) => ({ ...i, concept: { ...i.concept, conceptName: 'other' } }))
    expect(sameExpression(items, renamed)).toBe(true)
    expect(sameExpression(items, setItemFlag(items, 0, 'isExcluded', true))).toBe(false)
    const custom = customConceptItem(CUSTOM_CONCEPT_BASE, { name: 'A', domainId: 'D', conceptClassId: 'C', code: '', vocabularyId: '' }, { id: 'X', codePrefix: 'X-' }, '2026-01-01')
    const renamedCustom = { ...custom, concept: { ...custom.concept, conceptName: 'B' } }
    expect(expressionKey([custom])).not.toBe(expressionKey([renamedCustom]))
    expect(sameExpression(null, [])).toBe(true)
  })
})

describe('parseAtlasExpression', () => {
  it('reads ATLAS uppercase keys and YYYYMMDD dates', () => {
    const atlas = {
      items: [
        {
          concept: {
            CONCEPT_ID: 3027018,
            CONCEPT_NAME: 'Heart rate',
            STANDARD_CONCEPT: 'S',
            STANDARD_CONCEPT_CAPTION: 'Standard',
            INVALID_REASON: 'V',
            INVALID_REASON_CAPTION: 'Valid',
            CONCEPT_CODE: '8867-4',
            DOMAIN_ID: 'Measurement',
            VOCABULARY_ID: 'LOINC',
            CONCEPT_CLASS_ID: 'Clinical Observation',
            VALID_START_DATE: '19700101',
            VALID_END_DATE: '20991231',
          },
          isExcluded: false,
          includeDescendants: true,
          includeMapped: false,
        },
      ],
    }
    const r = parseAtlasExpression(JSON.stringify(atlas))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.skipped).toBe(0)
    expect(r.items[0]).toEqual({
      concept: {
        conceptId: 3027018,
        conceptName: 'Heart rate',
        domainId: 'Measurement',
        vocabularyId: 'LOINC',
        conceptClassId: 'Clinical Observation',
        standardConcept: 'S',
        standardConceptCaption: 'Standard',
        conceptCode: '8867-4',
        validStartDate: '1970-01-01',
        validEndDate: '2099-12-31',
        invalidReason: null,
        invalidReasonCaption: 'Valid',
      },
      isExcluded: false,
      includeDescendants: true,
      includeMapped: false,
    })
  })

  it('reads this format’s camelCase keys, and a whole concept set', () => {
    const cs = { id: 1, expression: { items: [itemFromConcept(concept(5)), { concept: { conceptId: 6, conceptName: 'x', standardConcept: 'N' }, isExcluded: 1 }] } }
    const r = parseAtlasExpression(JSON.stringify(cs))
    expect(r.ok && r.items.map((i) => [i.concept.conceptId, i.concept.standardConcept, i.isExcluded])).toEqual([
      [5, 'S', false],
      [6, null, true],
    ])
  })

  it('skips items without a usable id', () => {
    const r = parseAtlasExpression(
      JSON.stringify({ items: [{ concept: {} }, { concept: { CONCEPT_ID: 'abc' } }, { concept: { conceptId: -3 } }, { concept: { CONCEPT_ID: '42' } }, null] }),
    )
    expect(r.ok && r.items.map((i) => i.concept.conceptId)).toEqual([42])
    expect(r.ok && r.skipped).toBe(4)
  })

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['{nope', 'invalid_json'],
    ['{"items": []}', 'no_items'],
    ['[1, 2]', 'no_items'],
    ['{"expression": {"items": "x"}}', 'no_items'],
  ])('refuses %j (%s)', (input, error) => {
    const r = parseAtlasExpression(input)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toBe(error)
  })
})

describe('custom concepts', () => {
  const vocab = customVocabulary({ customVocabulary: { id: 'INDICATE', codePrefix: 'INDICATE-' } })

  it('defaults the custom vocabulary as v1', () => {
    expect(customVocabulary({})).toEqual({ id: 'CUSTOM', codePrefix: 'CUSTOM-' })
    expect(vocab).toEqual({ id: 'INDICATE', codePrefix: 'INDICATE-' })
  })

  it('allocates above every custom id in use, never below the base', () => {
    expect(nextCustomConceptId([])).toBe(CUSTOM_CONCEPT_BASE)
    expect(nextCustomConceptId([3027018, 2_000_000_500])).toBe(CUSTOM_CONCEPT_BASE)
    expect(nextCustomConceptId([CUSTOM_CONCEPT_BASE + 9, CUSTOM_CONCEPT_BASE + 3])).toBe(CUSTOM_CONCEPT_BASE + 10)
    expect(nextCustomConceptId([Number.NaN, CUSTOM_CONCEPT_BASE])).toBe(CUSTOM_CONCEPT_BASE + 1)
  })

  it('collects the custom ids of several expressions', () => {
    const a: ExpressionItem[] = [itemFromConcept(concept(1)), customConceptItem(CUSTOM_CONCEPT_BASE + 2, { name: 'x', domainId: 'd', conceptClassId: 'c', code: '', vocabularyId: '' }, vocab, '2026-01-01')]
    expect(customIds(a, null, [itemFromConcept(concept(CUSTOM_CONCEPT_BASE + 7))])).toEqual([CUSTOM_CONCEPT_BASE + 2, CUSTOM_CONCEPT_BASE + 7])
  })

  it('builds a non-standard item with v1’s defaults', () => {
    const item = customConceptItem(CUSTOM_CONCEPT_BASE + 1, { name: ' Triage ', domainId: 'Observation', conceptClassId: 'Custom', code: '', vocabularyId: '' }, vocab, '2026-03-04', true)
    expect(item).toEqual({
      concept: {
        conceptId: CUSTOM_CONCEPT_BASE + 1,
        conceptName: 'Triage',
        domainId: 'Observation',
        vocabularyId: 'INDICATE',
        conceptClassId: 'Custom',
        standardConcept: null,
        standardConceptCaption: 'Non-Standard',
        conceptCode: `INDICATE-${CUSTOM_CONCEPT_BASE + 1}`,
        validStartDate: '2026-03-04',
        validEndDate: '2099-12-31',
        invalidReason: null,
        invalidReasonCaption: 'Valid',
      },
      isExcluded: true,
      includeDescendants: false,
      includeMapped: false,
    })
  })

  it('requires a name, a domain and a class', () => {
    expect(customConceptErrors({ name: ' ', domainId: '', conceptClassId: 'x', code: '', vocabularyId: '' })).toEqual(['name', 'domain'])
  })

  it('edits only custom concepts', () => {
    const items = [itemFromConcept(concept(1)), customConceptItem(CUSTOM_CONCEPT_BASE, { name: 'a', domainId: 'd', conceptClassId: 'c', code: 'K', vocabularyId: '' }, vocab, '2026-01-01')]
    const fields = { name: 'b', domainId: 'Measurement', conceptClassId: 'Lab', code: '', vocabularyId: 'LOCAL' }
    const out = updateCustomConcept(items, 1, fields, vocab)
    expect(out[1].concept).toMatchObject({ conceptName: 'b', domainId: 'Measurement', vocabularyId: 'LOCAL', conceptCode: `INDICATE-${CUSTOM_CONCEPT_BASE}`, validStartDate: '2026-01-01' })
    expect(updateCustomConcept(items, 0, fields, vocab)[0]).toBe(items[0])
  })
})
