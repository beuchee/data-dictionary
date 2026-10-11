// Ported from legacy/concept-sets.js (submitAddConcepts, submitImport,
// getNextCustomConceptId, submitCustomConcept, saveEditCustomConcept, row
// toggles and deletes) as pure functions over `expression.items`.
import { cloneContent } from '@/lib/export/provenance'
import type { OmopConcept } from '@/lib/vocabulary'
import type { ConceptRef, ConceptSet, ExpressionItem, StandardConcept } from '@data-dictionary/format'

/**
 * Custom concepts (not in the OHDSI vocabularies) get ids from here up: the
 * resolver (resolve.py and its ports) takes the details of any id at or above
 * it from the expression instead of the vocabulary. v1's `CUSTOM_CONCEPT_BASE`.
 */
export const CUSTOM_CONCEPT_BASE = 2_100_000_000

export type ItemFlag = 'isExcluded' | 'includeDescendants' | 'includeMapped'

export interface ItemFlags {
  isExcluded: boolean
  includeDescendants: boolean
  includeMapped: boolean
}

export const NO_FLAGS: ItemFlags = { isExcluded: false, includeDescendants: false, includeMapped: false }

/** `YYYYMMDD` (legacy, ATLAS) or a timestamp → `YYYY-MM-DD`; empty stays empty. */
export function normalizeVocabDate(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  const s = String(value)
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return s
}

/** ATLAS's caption of a `standard_concept` value. */
export function standardCaption(standard: string | null | undefined): string {
  if (standard === 'S') return 'Standard'
  if (standard === 'C') return 'Classification'
  return 'Non-Standard'
}

function standardValue(value: unknown): StandardConcept {
  return value === 'S' || value === 'C' ? value : null
}

/**
 * The expression item of a vocabulary concept, every field copied from the
 * vocabulary row (never typed by hand), in the field order of
 * `concept_set.example.json`.
 */
export function itemFromConcept(c: OmopConcept, flags: ItemFlags = NO_FLAGS): ExpressionItem {
  const standard = standardValue(c.standardConcept)
  const invalidReason = c.invalidReason || null
  return {
    concept: {
      conceptId: c.conceptId,
      conceptName: c.conceptName ?? '',
      domainId: c.domainId ?? '',
      vocabularyId: c.vocabularyId ?? '',
      conceptClassId: c.conceptClassId ?? '',
      standardConcept: standard,
      standardConceptCaption: standardCaption(standard),
      conceptCode: c.conceptCode ?? '',
      validStartDate: normalizeVocabDate(c.validStartDate),
      validEndDate: normalizeVocabDate(c.validEndDate),
      invalidReason,
      invalidReasonCaption: invalidReason ? 'Invalid' : 'Valid',
    },
    isExcluded: flags.isExcluded,
    includeDescendants: flags.includeDescendants,
    includeMapped: flags.includeMapped,
  }
}

export interface AddResult {
  items: ExpressionItem[]
  added: number
  /** Already in the expression (same concept id): left as they were. */
  skipped: number
}

/** `items` plus `incoming`, skipping any concept id already present (v1: one item per concept). */
export function addItems(items: readonly ExpressionItem[], incoming: readonly ExpressionItem[]): AddResult {
  const seen = new Set(items.map((i) => i.concept.conceptId))
  const out = [...items]
  let added = 0
  let skipped = 0
  for (const item of incoming) {
    if (seen.has(item.concept.conceptId)) {
      skipped++
      continue
    }
    seen.add(item.concept.conceptId)
    out.push(item)
    added++
  }
  return { items: out, added, skipped }
}

/** `items` with `flag` of the item at `index` set to `value`. */
export function setItemFlag(items: readonly ExpressionItem[], index: number, flag: ItemFlag, value: boolean): ExpressionItem[] {
  return items.map((item, i) => (i === index ? { ...item, [flag]: value } : item))
}

/** `items` without those at `indexes`. */
export function removeItems(items: readonly ExpressionItem[], indexes: Iterable<number>): ExpressionItem[] {
  const drop = new Set(indexes)
  return items.filter((_, i) => !drop.has(i))
}

/** `cs` with `items` as its expression (other expression keys kept). */
export function withItems(cs: ConceptSet, items: ExpressionItem[]): ConceptSet {
  return { ...cs, expression: { ...(cs.expression ?? {}), items } }
}

/** The part of an item resolution depends on (custom concepts carry their details). */
function resolutionKey(item: ExpressionItem): unknown[] {
  const c = item.concept
  const base: unknown[] = [c.conceptId, !!item.isExcluded, !!item.includeDescendants, !!item.includeMapped]
  if (c.conceptId >= CUSTOM_CONCEPT_BASE) {
    base.push(c.conceptName, c.vocabularyId, c.domainId, c.conceptClassId, c.conceptCode, c.standardConcept ?? null)
  }
  return base
}

/** A string that changes exactly when the resolution of `items` may change. */
export function expressionKey(items: readonly ExpressionItem[] | null | undefined): string {
  return JSON.stringify((items ?? []).map(resolutionKey))
}

/** Whether two expressions resolve to the same concepts by construction (same items, any order of keys). */
export function sameExpression(a: readonly ExpressionItem[] | null | undefined, b: readonly ExpressionItem[] | null | undefined): boolean {
  return expressionKey(a) === expressionKey(b)
}

// --- ATLAS JSON import ---------------------------------------------------------

export type AtlasImportError = 'empty' | 'invalid_json' | 'no_items'

export type AtlasImportResult =
  | { ok: true; items: ExpressionItem[]; skipped: number }
  | { ok: false; error: AtlasImportError; detail?: string }

function pick(c: Record<string, unknown>, upper: string, camel: string): unknown {
  const v = c[upper]
  return v !== undefined && v !== null && v !== '' ? v : c[camel]
}

function text(value: unknown): string {
  return value === undefined || value === null ? '' : String(value)
}

/**
 * The items of a pasted ATLAS concept set expression (`{items: [...]}`, or a
 * whole INDICATE / ATLAS concept set holding one under `expression`). Reads
 * ATLAS's uppercase keys (`CONCEPT_ID`, `STANDARD_CONCEPT`…) and this format's
 * camelCase ones; `YYYYMMDD` dates become `YYYY-MM-DD`. Items without a valid
 * concept id are skipped; duplicates are left to `addItems`.
 */
export function parseAtlasExpression(input: string): AtlasImportResult {
  const trimmed = input.trim()
  if (!trimmed) return { ok: false, error: 'empty' }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (e) {
    return { ok: false, error: 'invalid_json', detail: e instanceof Error ? e.message : String(e) }
  }
  const root = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>
  const expression = (root.expression && typeof root.expression === 'object' ? root.expression : root) as Record<string, unknown>
  const raw = expression.items
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: 'no_items' }

  const items: ExpressionItem[] = []
  let skipped = 0
  for (const entry of raw) {
    const e = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    const c = (e.concept && typeof e.concept === 'object' ? e.concept : {}) as Record<string, unknown>
    const rawId = pick(c, 'CONCEPT_ID', 'conceptId')
    const id = typeof rawId === 'number' || (typeof rawId === 'string' && /^\d+$/.test(rawId)) ? Number(rawId) : NaN
    if (!Number.isSafeInteger(id) || id <= 0) {
      skipped++
      continue
    }
    const standard = standardValue(pick(c, 'STANDARD_CONCEPT', 'standardConcept'))
    // ATLAS spells a valid concept 'V'; this format writes null.
    const reason = text(pick(c, 'INVALID_REASON', 'invalidReason'))
    const invalidReason = reason && reason !== 'V' ? reason : null
    const concept: ConceptRef = {
      conceptId: id,
      conceptName: text(pick(c, 'CONCEPT_NAME', 'conceptName')),
      domainId: text(pick(c, 'DOMAIN_ID', 'domainId')),
      vocabularyId: text(pick(c, 'VOCABULARY_ID', 'vocabularyId')),
      conceptClassId: text(pick(c, 'CONCEPT_CLASS_ID', 'conceptClassId')),
      standardConcept: standard,
      standardConceptCaption: text(pick(c, 'STANDARD_CONCEPT_CAPTION', 'standardConceptCaption')) || standardCaption(standard),
      conceptCode: text(pick(c, 'CONCEPT_CODE', 'conceptCode')),
      validStartDate: normalizeVocabDate(pick(c, 'VALID_START_DATE', 'validStartDate')),
      validEndDate: normalizeVocabDate(pick(c, 'VALID_END_DATE', 'validEndDate')),
      invalidReason,
      invalidReasonCaption: text(pick(c, 'INVALID_REASON_CAPTION', 'invalidReasonCaption')) || (invalidReason ? 'Invalid' : 'Valid'),
    }
    items.push({
      concept,
      isExcluded: !!e.isExcluded,
      includeDescendants: !!e.includeDescendants,
      includeMapped: !!e.includeMapped,
    })
  }
  return { ok: true, items, skipped }
}

// --- Custom concepts -----------------------------------------------------------

export function isCustomId(conceptId: number): boolean {
  return conceptId >= CUSTOM_CONCEPT_BASE
}

/** The custom concept ids used by `items` (several expressions may be passed). */
export function customIds(...expressions: (readonly ExpressionItem[] | null | undefined)[]): number[] {
  const out: number[] = []
  for (const items of expressions) for (const i of items ?? []) if (isCustomId(i.concept?.conceptId)) out.push(i.concept.conceptId)
  return out
}

/** The next custom concept id: one above every custom id already used (catalog, drafts, this expression). */
export function nextCustomConceptId(usedIds: Iterable<number>): number {
  let max = CUSTOM_CONCEPT_BASE - 1
  for (const id of usedIds) if (Number.isSafeInteger(id) && id > max) max = id
  return max + 1
}

export interface CustomConceptFields {
  name: string
  domainId: string
  conceptClassId: string
  /** Empty: `{codePrefix}{id}`. */
  code: string
  /** Empty: the instance's custom vocabulary id. */
  vocabularyId: string
}

export interface CustomVocabulary {
  id: string
  codePrefix: string
}

/** config.json `customVocabulary`, with v1's defaults. */
export function customVocabulary(config: { customVocabulary?: { id?: string | null; codePrefix?: string | null } | null }): CustomVocabulary {
  return {
    id: config.customVocabulary?.id || 'CUSTOM',
    codePrefix: config.customVocabulary?.codePrefix || 'CUSTOM-',
  }
}

/** Missing name, domain or class (the fields v1 requires). */
export function customConceptErrors(fields: CustomConceptFields): ('name' | 'domain' | 'class')[] {
  const errors: ('name' | 'domain' | 'class')[] = []
  if (!fields.name.trim()) errors.push('name')
  if (!fields.domainId.trim()) errors.push('domain')
  if (!fields.conceptClassId.trim()) errors.push('class')
  return errors
}

/**
 * A custom concept item (v1's `submitCustomConcept`): non-standard, valid from
 * `today` to 2099-12-31, its code defaulting to the vocabulary's prefix + id.
 */
export function customConceptItem(
  id: number,
  fields: CustomConceptFields,
  vocabulary: CustomVocabulary,
  today: string,
  isExcluded = false,
): ExpressionItem {
  return {
    concept: {
      conceptId: id,
      conceptName: fields.name.trim(),
      domainId: fields.domainId.trim(),
      vocabularyId: fields.vocabularyId.trim() || vocabulary.id,
      conceptClassId: fields.conceptClassId.trim(),
      standardConcept: null,
      standardConceptCaption: standardCaption(null),
      conceptCode: fields.code.trim() || `${vocabulary.codePrefix}${id}`,
      validStartDate: today,
      validEndDate: '2099-12-31',
      invalidReason: null,
      invalidReasonCaption: 'Valid',
    },
    isExcluded,
    includeDescendants: false,
    includeMapped: false,
  }
}

/** `items` with the custom concept at `index` renamed / reclassified (v1's `saveEditCustomConcept`). */
export function updateCustomConcept(
  items: readonly ExpressionItem[],
  index: number,
  fields: CustomConceptFields,
  vocabulary: CustomVocabulary,
): ExpressionItem[] {
  return items.map((item, i) => {
    if (i !== index || !isCustomId(item.concept.conceptId)) return item
    const c = cloneContent(item.concept)
    c.conceptName = fields.name.trim()
    c.domainId = fields.domainId.trim()
    c.vocabularyId = fields.vocabularyId.trim() || vocabulary.id
    c.conceptClassId = fields.conceptClassId.trim()
    c.conceptCode = fields.code.trim() || `${vocabulary.codePrefix}${c.conceptId}`
    return { ...item, concept: c }
  })
}

/** The fields of an existing custom concept, for its edit form. */
export function customConceptFields(concept: ConceptRef): CustomConceptFields {
  return {
    name: concept.conceptName ?? '',
    domainId: concept.domainId ?? '',
    conceptClassId: concept.conceptClassId ?? '',
    code: concept.conceptCode ?? '',
    vocabularyId: concept.vocabularyId ?? '',
  }
}
