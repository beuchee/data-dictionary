/**
 * Validation of content files against schemas/*.schema.json (ajv, JSON Schema
 * 2020-12). Errors name the file kind and a JSON pointer into the document.
 * Twin: python/src/dictionary_format/validate.py.
 */
import * as AjvModule from 'ajv/dist/2020.js'
import * as AjvFormatsModule from 'ajv-formats'
import type { ErrorObject, ValidateFunction } from 'ajv'
import conceptSetSchema from '../schemas/concept-set.schema.json' with { type: 'json' }
import conceptSetResolvedSchema from '../schemas/concept-set-resolved.schema.json' with { type: 'json' }
import projectSchema from '../schemas/project.schema.json' with { type: 'json' }
import recommendedUnitsSchema from '../schemas/recommended-units.schema.json' with { type: 'json' }
import unitConversionsSchema from '../schemas/unit-conversions.schema.json' with { type: 'json' }
import mappingRecommendationsSchema from '../schemas/mapping-recommendations.schema.json' with { type: 'json' }
import configSchema from '../schemas/config.schema.json' with { type: 'json' }
import conceptSetsVersionsSchema from '../schemas/concept-sets-versions.schema.json' with { type: 'json' }
import idCountersSchema from '../schemas/id-counters.schema.json' with { type: 'json' }
import { kindForPath, type FileKind } from './kinds.ts'
import { toPlain } from './number.ts'
import { parse } from './parse.ts'

export const SCHEMAS: Readonly<Record<FileKind, object>> = {
  'concept-set': conceptSetSchema,
  'concept-set-resolved': conceptSetResolvedSchema,
  project: projectSchema,
  'recommended-units': recommendedUnitsSchema,
  'unit-conversions': unitConversionsSchema,
  'mapping-recommendations': mappingRecommendationsSchema,
  config: configSchema,
  'concept-sets-versions': conceptSetsVersionsSchema,
  'id-counters': idCountersSchema,
}

export interface ValidationIssue {
  kind: FileKind
  /** JSON pointer of the offending value ('' = document root). */
  pointer: string
  /** Schema keyword that failed (required, enum, type, pattern…). */
  keyword: string
  message: string
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationIssue[]
}

export class DictionaryFormatError extends Error {
  readonly issues: ValidationIssue[]
  constructor(issues: ValidationIssue[], label?: string) {
    super(`${label ? `${label}: ` : ''}${issues.length} format error(s)\n${formatIssues(issues)}`)
    this.name = 'DictionaryFormatError'
    this.issues = issues
  }
}

// ajv and ajv-formats are CommonJS: the class / plugin is the default export
// under a bundler, but sits on `.default` under plain Node ESM.
type AjvCtor = typeof import('ajv/dist/2020.js').default
const unwrap = <T>(mod: unknown): T => {
  let m = mod as { default?: unknown }
  while (m && typeof m !== 'function' && m.default) m = m.default as { default?: unknown }
  return m as T
}
const Ajv2020 = unwrap<AjvCtor>(AjvModule)
const addFormats = unwrap<typeof import('ajv-formats').default>(AjvFormatsModule)

let compiled: Map<FileKind, ValidateFunction> | null = null

function validator(kind: FileKind): ValidateFunction {
  if (!compiled) {
    const ajv = new Ajv2020({ allErrors: true, verbose: true, strict: false })
    addFormats(ajv, ['date', 'uuid'])
    compiled = new Map()
    for (const [k, schema] of Object.entries(SCHEMAS) as [FileKind, object][]) compiled.set(k, ajv.compile(schema))
  }
  const fn = compiled.get(kind)
  if (!fn) throw new Error(`Unknown file kind: ${kind}`)
  return fn
}

/** Validate a parsed document (RawNumbers are read as their numeric value). */
export function validate(kind: FileKind, value: unknown): ValidationResult {
  const fn = validator(kind)
  if (fn(toPlain(value))) return { valid: true, errors: [] }
  const errors = (fn.errors ?? []).map((e) => toIssue(kind, e))
  return { valid: false, errors }
}

/** Throw a DictionaryFormatError unless `value` is valid. */
export function assertValid(kind: FileKind, value: unknown, label?: string): void {
  const result = validate(kind, value)
  if (!result.valid) throw new DictionaryFormatError(result.errors, label)
}

/** Parse and validate a file given its path relative to the repo root. */
export function validateFile(relPath: string, text: string): ValidationResult {
  const kind = kindForPath(relPath)
  if (!kind) throw new Error(`Not a dictionary content file: ${relPath}`)
  return validate(kind, parse(text))
}

export function formatIssues(issues: readonly ValidationIssue[]): string {
  return issues.map((i) => `  ${i.kind} ${i.pointer || '/'}: ${i.message}`).join('\n')
}

function show(value: unknown): string {
  const s = JSON.stringify(value) ?? String(value)
  return s.length > 80 ? `${s.slice(0, 77)}...` : s
}

function toIssue(kind: FileKind, e: ErrorObject): ValidationIssue {
  const p = e.params as Record<string, unknown>
  let message: string
  switch (e.keyword) {
    case 'required':
      message = `missing required property "${p.missingProperty}"`
      break
    case 'enum':
      message = `must be one of ${(p.allowedValues as unknown[]).map(show).join(', ')} (got ${show(e.data)})`
      break
    case 'type':
      message = `must be ${p.type} (got ${show(e.data)})`
      break
    case 'pattern':
      message = `must match pattern ${p.pattern} (got ${show(e.data)})`
      break
    case 'format':
      message = `must be a valid ${p.format} (got ${show(e.data)})`
      break
    case 'propertyNames':
      message = `invalid property name ${show(p.propertyName)}`
      break
    case 'anyOf':
    case 'oneOf':
      message = 'does not match any of the accepted shapes (see the other errors at this location)'
      break
    default:
      message = `${e.message ?? 'is invalid'}${e.data !== undefined && typeof e.data !== 'object' ? ` (got ${show(e.data)})` : ''}`
  }
  return { kind, pointer: e.instancePath, keyword: e.keyword, message }
}
