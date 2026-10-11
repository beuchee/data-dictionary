// Ported from legacy/settings.js (submitAddConv, submitAddRU, startEditFactor,
// updateTestResult, deleteSelectedRows), as pure functions over the file's rows.
// Rows are never rebuilt when untouched: a parsed `1.0` (a RawNumber) must reach
// `serialize` as it came, so editing one row leaves every other byte alone.
import { RawNumber, serialize, toNumber, type JsonNumber, type RecommendedUnit, type UnitConversion } from '@data-dictionary/format'
import { contentEqual } from '@/lib/drafts/diff'

/** A concept as the dialogs hold it: from the vocabulary, or typed when none is loaded. */
export interface ConceptRef {
  conceptId: number
  conceptName: string
  conceptCode?: string
  vocabularyId?: string
  domainId?: string
}

export type UnitsKind = 'unit-conversions' | 'recommended-units'

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/**
 * A number typed by the user, with its lexeme kept when JavaScript would print
 * it otherwise (`1.0`, `0.10`): what they typed is what the file gets. A comma
 * decimal separator is accepted. null for anything that is not a finite number.
 */
export function parseNumberInput(text: string): JsonNumber | null {
  const raw = text.trim().replace(',', '.')
  if (!/^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(raw)) return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  return String(n) === raw ? n : new RawNumber(raw)
}

/** A number as shown in a table cell or an input: the file's lexeme. */
export function numberText(value: JsonNumber | undefined | null): string {
  if (value === undefined || value === null) return ''
  return value instanceof RawNumber ? value.raw : String(value)
}

/** target = source × conversionFactor + offset (offset absent = 0). */
export function convertValue(value: number, row: Pick<UnitConversion, 'conversionFactor' | 'offset'>): number {
  return value * toNumber(row.conversionFactor) + (row.offset === undefined ? 0 : toNumber(row.offset))
}

/** A converted value for display: 10 significant digits, no float noise (`0.1 + 0.2` → `0.3`). */
export function formatConverted(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return String(parseFloat(value.toPrecision(10)))
}

/** ` × 0.0555 + 32`, `× 1.8 − 40`: the affine formula of a row, as v1 labelled it. */
export function formulaLabel(row: Pick<UnitConversion, 'conversionFactor' | 'offset'>): string {
  let label = `× ${formatConverted(toNumber(row.conversionFactor))}`
  const offset = row.offset === undefined ? 0 : toNumber(row.offset)
  if (offset > 0) label += ` + ${formatConverted(offset)}`
  else if (offset < 0) label += ` − ${formatConverted(Math.abs(offset))}`
  return label
}

// ---------------------------------------------------------------------------
// Unit conversions
// ---------------------------------------------------------------------------

export interface ConversionForm {
  concept: ConceptRef | null
  source: ConceptRef | null
  target: ConceptRef | null
  factor: string
  offset: string
}

export type ConversionFormError =
  | 'missing_concepts'
  | 'invalid_factor'
  | 'factor_not_positive'
  | 'invalid_offset'
  | 'same_units'
  | 'duplicate'

/** v1's checks, in its order; `editIndex` is the row being edited (null when adding). */
export function validateConversion(
  form: ConversionForm,
  rows: readonly UnitConversion[],
  editIndex: number | null,
): ConversionFormError | null {
  const { concept, source, target } = form
  if (!concept || !source || !target || !validId(concept.conceptId) || !validId(source.conceptId) || !validId(target.conceptId)) {
    return 'missing_concepts'
  }
  const factor = parseNumberInput(form.factor)
  if (factor === null) return 'invalid_factor'
  if (toNumber(factor) <= 0) return 'factor_not_positive'
  if (form.offset.trim() !== '' && parseNumberInput(form.offset) === null) return 'invalid_offset'
  if (source.conceptId === target.conceptId) return 'same_units'
  const duplicate = rows.some(
    (r, i) =>
      i !== editIndex &&
      r.conceptId === concept.conceptId &&
      r.sourceUnitConceptId === source.conceptId &&
      r.targetUnitConceptId === target.conceptId,
  )
  return duplicate ? 'duplicate' : null
}

function validId(id: number): boolean {
  return Number.isSafeInteger(id) && id > 0
}

/**
 * The row a valid form describes. Editing keeps the row's other keys and their
 * order; a new row follows the file's key order. An offset of 0 (or none) drops
 * the `offset` key, so purely multiplicative rows stay free of it (v1).
 */
export function buildConversionRow(form: ConversionForm, existing?: UnitConversion): UnitConversion {
  const { concept, source, target } = form
  if (!concept || !source || !target) throw new Error('buildConversionRow: incomplete form')
  const factor = parseNumberInput(form.factor)
  if (factor === null) throw new Error('buildConversionRow: invalid factor')
  const offset = form.offset.trim() === '' ? null : parseNumberInput(form.offset)
  const keepOffset = offset !== null && toNumber(offset) !== 0
  // The file's key order: `offset` right after the factor.
  const row: UnitConversion = {
    conceptId: concept.conceptId,
    conceptName: concept.conceptName.trim(),
    sourceUnitConceptId: source.conceptId,
    sourceUnitCode: (source.conceptCode ?? '').trim(),
    sourceUnitName: source.conceptName.trim(),
    conversionFactor: sameNumber(existing?.conversionFactor, factor) ? (existing as UnitConversion).conversionFactor : factor,
    ...(keepOffset ? { offset: sameNumber(existing?.offset, offset) ? existing?.offset : offset } : {}),
    targetUnitConceptId: target.conceptId,
    targetUnitCode: (target.conceptCode ?? '').trim(),
    targetUnitName: target.conceptName.trim(),
  }
  // Keys this editor does not know about stay, after the known ones.
  for (const [key, value] of Object.entries(existing ?? {})) {
    if (!(key in row) && key !== 'offset') row[key] = value
  }
  // Nothing changed: the row as it was, key order and lexemes included.
  return existing && contentEqual(existing, row) ? existing : row
}

function sameNumber(a: JsonNumber | undefined, b: JsonNumber): boolean {
  return a !== undefined && toNumber(a) === toNumber(b)
}

/** The form showing an existing row. */
export function conversionForm(row?: UnitConversion): ConversionForm {
  if (!row) return { concept: null, source: null, target: null, factor: '', offset: '' }
  return {
    concept: { conceptId: row.conceptId, conceptName: row.conceptName ?? '' },
    source: { conceptId: row.sourceUnitConceptId, conceptName: row.sourceUnitName ?? '', conceptCode: row.sourceUnitCode ?? '' },
    target: { conceptId: row.targetUnitConceptId, conceptName: row.targetUnitName ?? '', conceptCode: row.targetUnitCode ?? '' },
    factor: numberText(row.conversionFactor),
    offset: row.offset === undefined || toNumber(row.offset) === 0 ? '' : numberText(row.offset),
  }
}

/**
 * The inline factor edit: null when the text is refused (not a positive
 * number). An unchanged value returns `rows` itself, keeping the lexeme.
 */
export function setConversionFactor(rows: readonly UnitConversion[], index: number, text: string): UnitConversion[] | null {
  const factor = parseNumberInput(text)
  if (factor === null || toNumber(factor) <= 0 || !rows[index]) return null
  if (toNumber(rows[index].conversionFactor) === toNumber(factor)) return rows as UnitConversion[]
  return rows.map((r, i) => (i === index ? { ...r, conversionFactor: factor } : r))
}

// ---------------------------------------------------------------------------
// Recommended units
// ---------------------------------------------------------------------------

export interface RecommendedForm {
  concept: ConceptRef | null
  unit: ConceptRef | null
}

export type RecommendedFormError = 'missing_concepts' | 'duplicate'

export function validateRecommended(
  form: RecommendedForm,
  rows: readonly RecommendedUnit[],
  editIndex: number | null,
): RecommendedFormError | null {
  const { concept, unit } = form
  if (!concept || !unit || !validId(concept.conceptId) || !validId(unit.conceptId)) return 'missing_concepts'
  const duplicate = rows.some(
    (r, i) => i !== editIndex && r.conceptId === concept.conceptId && r.recommendedUnitConceptId === unit.conceptId,
  )
  return duplicate ? 'duplicate' : null
}

export function buildRecommendedRow(form: RecommendedForm, existing?: RecommendedUnit): RecommendedUnit {
  const { concept, unit } = form
  if (!concept || !unit) throw new Error('buildRecommendedRow: incomplete form')
  const fields: RecommendedUnit = {
    conceptId: concept.conceptId,
    conceptName: concept.conceptName.trim(),
    conceptCode: (concept.conceptCode ?? '').trim(),
    vocabularyId: (concept.vocabularyId ?? '').trim(),
    domainId: (concept.domainId ?? '').trim(),
    recommendedUnitConceptId: unit.conceptId,
    recommendedUnitName: unit.conceptName.trim(),
    recommendedUnitCode: (unit.conceptCode ?? '').trim(),
    recommendedUnitVocabularyId: (unit.vocabularyId ?? '').trim(),
  }
  if (!existing) return fields
  const row = { ...existing, ...fields }
  return contentEqual(existing, row) ? existing : row
}

export function recommendedForm(row?: RecommendedUnit): RecommendedForm {
  if (!row) return { concept: null, unit: null }
  return {
    concept: {
      conceptId: row.conceptId,
      conceptName: row.conceptName ?? '',
      conceptCode: row.conceptCode ?? '',
      vocabularyId: row.vocabularyId ?? '',
      domainId: row.domainId ?? '',
    },
    unit: {
      conceptId: row.recommendedUnitConceptId,
      conceptName: row.recommendedUnitName ?? '',
      conceptCode: row.recommendedUnitCode ?? '',
      vocabularyId: row.recommendedUnitVocabularyId ?? '',
    },
  }
}

// ---------------------------------------------------------------------------
// Both files
// ---------------------------------------------------------------------------

/** `rows` with `row` at `index` (replaced) or appended (index null). */
export function upsertRow<T>(rows: readonly T[], row: T, index: number | null): T[] {
  if (index === null || index < 0 || index >= rows.length) return [...rows, row]
  return rows.map((r, i) => (i === index ? row : r))
}

/** `rows` without the given indices; the others keep their order (and identity). */
export function removeRows<T>(rows: readonly T[], indices: Iterable<number>): T[] {
  const drop = new Set(indices)
  return rows.filter((_, i) => !drop.has(i))
}

/** The file's bytes, as the repository holds them (number lexemes kept). */
export function exportUnitsFile(rows: readonly unknown[], kind: UnitsKind): string {
  return serialize(rows, { kind })
}

export const UNITS_FILE_NAME: Record<UnitsKind, string> = {
  'unit-conversions': 'unit_conversions.json',
  'recommended-units': 'recommended_units.json',
}
