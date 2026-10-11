// Ported from legacy/concept-sets.js (DOMAIN_TABLE_MAP, buildOMOPSQL). The SQL
// text is kept byte-identical to v1 (omop-sql.test.ts checks it against goldens
// generated from v1), with two hardenings v1 lacked: names and labels are
// flattened to one line before going into a `--` comment (a newline in a concept
// name used to end the comment and inject the rest as SQL), and only integer ids
// ever reach the SQL.
import type { ConceptSet, RecommendedUnit, ResolvedConcept, UnitConversion } from '@data-dictionary/format'
import { affineConversion, sqlExportConcepts, type AffineConversion } from './units'

export interface DomainTable {
  table: string
  conceptCol: string
  columns: readonly string[]
}

/** OMOP CDM table queried for each concept domain. Domains not listed get a comment instead. */
export const DOMAIN_TABLE_MAP: Readonly<Record<string, DomainTable>> = {
  Measurement: {
    table: 'measurement',
    conceptCol: 'measurement_concept_id',
    columns: ['person_id', 'measurement_concept_id', 'measurement_date', 'measurement_datetime',
      'value_as_number', 'value_as_concept_id', 'unit_concept_id',
      'measurement_source_value', 'measurement_source_concept_id', 'unit_source_value'],
  },
  Condition: {
    table: 'condition_occurrence',
    conceptCol: 'condition_concept_id',
    columns: ['person_id', 'condition_concept_id', 'condition_start_date', 'condition_start_datetime',
      'condition_end_date', 'condition_end_datetime', 'condition_type_concept_id',
      'condition_source_value', 'condition_source_concept_id'],
  },
  Drug: {
    table: 'drug_exposure',
    conceptCol: 'drug_concept_id',
    columns: ['person_id', 'drug_concept_id', 'drug_exposure_start_date', 'drug_exposure_start_datetime',
      'drug_exposure_end_date', 'drug_exposure_end_datetime', 'drug_type_concept_id',
      'quantity', 'dose_unit_source_value', 'drug_source_value', 'drug_source_concept_id'],
  },
  Procedure: {
    table: 'procedure_occurrence',
    conceptCol: 'procedure_concept_id',
    columns: ['person_id', 'procedure_concept_id', 'procedure_date', 'procedure_datetime',
      'procedure_type_concept_id', 'procedure_source_value', 'procedure_source_concept_id'],
  },
  Observation: {
    table: 'observation',
    conceptCol: 'observation_concept_id',
    columns: ['person_id', 'observation_concept_id', 'observation_date', 'observation_datetime',
      'value_as_number', 'value_as_string', 'value_as_concept_id', 'unit_concept_id',
      'observation_source_value', 'observation_source_concept_id'],
  },
  Device: {
    table: 'device_exposure',
    conceptCol: 'device_concept_id',
    columns: ['person_id', 'device_concept_id', 'device_exposure_start_date', 'device_exposure_start_datetime',
      'device_exposure_end_date', 'device_exposure_end_datetime', 'device_type_concept_id',
      'device_source_value', 'device_source_concept_id'],
  },
}

export function domainTable(domain: string): DomainTable | null {
  return Object.prototype.hasOwnProperty.call(DOMAIN_TABLE_MAP, domain) ? DOMAIN_TABLE_MAP[domain] : null
}

export interface OmopSqlOptions {
  conceptSet: ConceptSet
  /** The resolved list of that version of the set; only standard concepts are queried. */
  resolved: readonly ResolvedConcept[]
  unitConversions: readonly UnitConversion[]
  recommendedUnits: readonly RecommendedUnit[]
  /** Unit every Measurement value is converted to; null returns raw values. */
  referenceUnitId: number | null
  /** Emit the unit filter as live SQL instead of a commented-out suggestion. */
  dropOtherUnits?: boolean
  /** Labels shown by the unit picker (`unitLabelsFromOptions`); they win over units/*.json. */
  unitLabels?: Readonly<Record<number, string>>
  /** Content language of the set's name in the header (falls back to English, as v1). */
  lang: string
  /** Link back to this version of the set, printed in the header. */
  permalink: string
  /** `INDICATE Data Dictionary v… (url)`, see `toolTag`. */
  toolTag: string
  /** `YYYY-MM-DD` printed in the header. */
  date: string
}

/** Flattens text for a `--` comment: any line break would end the comment. */
export function sqlComment(value: unknown): string {
  return String(value).replace(/[\r\n\v\f\u0085\u2028\u2029]+/g, ' ')
}

const isSqlId = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n)

/** Display name of a set in `lang`, falling back to English then the root name (v1's `App.t`). */
export function conceptSetDisplayName(cs: ConceptSet, lang: string): string {
  const tr = cs.metadata?.translations
  const t = (tr && (tr[lang] || tr.en)) || {}
  return t.name || cs.name || 'Concept Set'
}

/** `value_as_number * factor (+|- offset)`, dropping a factor of 1 and an offset of 0. */
function conversionExpr(conv: AffineConversion): string {
  let expr = conv.factor === 1 ? 'value_as_number' : `value_as_number * ${conv.factor}`
  if (conv.offset > 0) expr += ` + ${conv.offset}`
  else if (conv.offset < 0) expr += ` - ${Math.abs(conv.offset)}`
  return expr
}

interface ConversionGroup {
  ids: number[]
  names: string[]
  srcIds: number[]
  map: Record<number, AffineConversion>
}

/** A ready-to-run OMOP CDM query per domain of the set, with unit harmonization for Measurement. */
export function buildOmopSql(options: OmopSqlOptions): string {
  const { conceptSet: cs, unitConversions, recommendedUnits, referenceUnitId, dropOtherUnits = false } = options
  const csName = sqlComment(conceptSetDisplayName(cs, options.lang))
  const permalink = sqlComment(options.permalink)
  const concepts = sqlExportConcepts(options.resolved).filter((c) => isSqlId(c.conceptId))
  const refUnitId = isSqlId(referenceUnitId) && referenceUnitId !== 0 ? referenceUnitId : null

  if (concepts.length === 0) {
    return `-- Concept Set: ${csName} (ID: ${sqlComment(cs.id)})\n` +
      `-- ${permalink}\n` +
      '-- No standard resolved concepts available.\n' +
      '-- Load an OHDSI vocabulary database or ensure concept sets are resolved.\n'
  }

  const byDomain = new Map<string, ResolvedConcept[]>()
  for (const c of concepts) {
    const d = c.domainId || 'Unknown'
    if (!byDomain.has(d)) byDomain.set(d, [])
    byDomain.get(d)!.push(c)
  }

  // Unit label: the picker's first, then the conversion rows (code, else name),
  // then the recommended units, each id taking the first label found.
  const unitLabels = new Map<number, string>()
  for (const [k, v] of Object.entries(options.unitLabels ?? {})) unitLabels.set(parseInt(k, 10), v)
  for (const conv of unitConversions) {
    if (conv.sourceUnitConceptId && !unitLabels.get(conv.sourceUnitConceptId)) {
      const l = conv.sourceUnitCode || conv.sourceUnitName
      if (l) unitLabels.set(conv.sourceUnitConceptId, l)
    }
    if (conv.targetUnitConceptId && !unitLabels.get(conv.targetUnitConceptId)) {
      const l = conv.targetUnitCode || conv.targetUnitName
      if (l) unitLabels.set(conv.targetUnitConceptId, l)
    }
  }
  for (const ru of recommendedUnits) {
    if (ru.recommendedUnitConceptId && !unitLabels.get(ru.recommendedUnitConceptId)) {
      const l = ru.recommendedUnitCode || ru.recommendedUnitName
      if (l) unitLabels.set(ru.recommendedUnitConceptId, l)
    }
  }
  const unitLabel = (id: number) => {
    const l = unitLabels.get(id)
    return l ? `${sqlComment(l)} (${id})` : String(id)
  }

  // Per concept: source unit → conversion into the reference unit. Factors depend
  // on the concept (molecular weight…), so they are kept apart. unit_conversions
  // stores both directions as separate rows: only rows targeting the reference count.
  function perConceptConversions(domainConcepts: ResolvedConcept[], refUid: number) {
    const perConcept = new Map<number, Record<number, AffineConversion>>()
    for (const c of domainConcepts) perConcept.set(c.conceptId, {})
    for (const conv of unitConversions) {
      if (conv.targetUnitConceptId !== refUid || !isSqlId(conv.sourceUnitConceptId)) continue
      const m = perConcept.get(conv.conceptId)
      const affine = affineConversion(conv)
      if (m && affine) m[conv.sourceUnitConceptId] = affine
    }
    return perConcept
  }

  const lines: string[] = []
  lines.push('-- ============================================================')
  lines.push(`-- Concept Set: ${csName} (ID: ${sqlComment(cs.id)}${cs.version ? `, version ${sqlComment(cs.version)}` : ''})`)
  lines.push(`-- ${permalink}`)
  lines.push(`-- Generated by ${sqlComment(options.toolTag)}`)
  lines.push(`-- Date: ${sqlComment(options.date)}`)
  lines.push('-- ============================================================')
  lines.push('')

  for (const domain of [...byDomain.keys()].sort()) {
    const domainConcepts = byDomain.get(domain)!
    const mapping = domainTable(domain)

    lines.push('-- ------------------------------------------------------------')
    lines.push(`-- Domain: ${sqlComment(domain)} (${domainConcepts.length} concepts)`)
    lines.push('-- ------------------------------------------------------------')

    if (!mapping) {
      lines.push(`-- No OMOP CDM table mapping for domain "${sqlComment(domain)}".`)
      lines.push('-- Concepts:')
      for (const c of domainConcepts) lines.push(`--   ${c.conceptId} -- ${sqlComment(c.conceptName)}`)
      lines.push('')
      continue
    }

    let valueAsNumberExpr: string | null = null
    let unitConceptIdExpr: string | null = null
    let convertedSrcUnits: number[] = []
    let ambiguous = false
    const convGroups: ConversionGroup[] = []

    if (domain === 'Measurement' && refUnitId) {
      const perConcept = perConceptConversions(domainConcepts, refUnitId)

      // Every conversion seen per source unit; two are the same only if factor and offset match.
      // Integer-keyed objects on purpose: their key order (ascending) is v1's output order.
      const convBySrc: Record<number, Record<string, AffineConversion>> = {}
      for (const c of domainConcepts) {
        const m = perConcept.get(c.conceptId) ?? {}
        for (const k of Object.keys(m)) {
          const src = Number(k)
          convBySrc[src] ??= {}
          convBySrc[src][`${m[src].factor}|${m[src].offset}`] = m[src]
        }
      }
      convertedSrcUnits = Object.keys(convBySrc).map((k) => parseInt(k, 10))
      ambiguous = convertedSrcUnits.some((src) => Object.keys(convBySrc[src]).length > 1)
      // A set is one clinical variable, so a (source → reference) factor applies
      // to all its concepts, even those without their own row: one flat CASE,
      // unless the table holds contradictory factors for one source unit. Then
      // the CASE switches per group of concepts sharing the same conversions.

      const bySig = new Map<string, ConversionGroup>()
      for (const c of domainConcepts) {
        const m = perConcept.get(c.conceptId) ?? {}
        const srcIds = Object.keys(m).map((k) => parseInt(k, 10)).sort((a, b) => a - b)
        if (srcIds.length === 0) continue
        const sig = srcIds.map((u) => `${u}:${m[u].factor}:${m[u].offset}`).join('|')
        let group = bySig.get(sig)
        if (!group) {
          group = { ids: [], names: [], srcIds, map: m }
          bySig.set(sig, group)
          convGroups.push(group)
        }
        group.ids.push(c.conceptId)
        group.names.push(sqlComment(c.conceptName))
      }

      if (!ambiguous) {
        const caseParts: string[] = []
        caseParts.push(`        -- Reference unit: ${unitLabel(refUnitId)}`)
        caseParts.push(`        WHEN unit_concept_id = ${refUnitId} THEN value_as_number`)
        for (const src of convertedSrcUnits) {
          const conv = Object.values(convBySrc[src])[0]
          caseParts.push(`        WHEN unit_concept_id = ${src} THEN ${conversionExpr(conv)}` +
            ` -- convert ${unitLabel(src)} -> ${unitLabel(refUnitId)}`)
        }
        valueAsNumberExpr = '    CASE\n' + caseParts.join('\n') +
          '\n        ELSE value_as_number -- unknown unit, no conversion available: value kept as-is (still in its original unit)' +
          '\n    END AS value_as_number'
      } else {
        const outerParts: string[] = []
        outerParts.push(`        -- Reference unit: ${unitLabel(refUnitId)}`)
        outerParts.push('        -- Conversions are concept-specific: switching per measurement_concept_id')
        for (const grp of convGroups) {
          if (grp.ids.length === 1) {
            outerParts.push(`        WHEN measurement_concept_id = ${grp.ids[0]} THEN -- ${grp.names[0]}`)
          } else {
            outerParts.push('        WHEN measurement_concept_id IN (')
            grp.ids.forEach((id, i) => {
              outerParts.push(`            ${id}${i < grp.ids.length - 1 ? ',' : ''} -- ${grp.names[i]}`)
            })
            outerParts.push('        ) THEN')
          }
          outerParts.push('            CASE')
          outerParts.push(`                WHEN unit_concept_id = ${refUnitId} THEN value_as_number`)
          for (const src of grp.srcIds) {
            outerParts.push(`                WHEN unit_concept_id = ${src} THEN ${conversionExpr(grp.map[src])}` +
              ` -- convert ${unitLabel(src)} -> ${unitLabel(refUnitId)}`)
          }
          outerParts.push('                ELSE value_as_number -- unknown unit, no conversion: value kept as-is')
          outerParts.push('            END')
        }
        outerParts.push('        ELSE value_as_number -- no conversion for this concept: value kept as-is')
        valueAsNumberExpr = '    CASE\n' + outerParts.join('\n') + '\n    END AS value_as_number'
      }

      // A converted value no longer matches its original unit_concept_id: relabel
      // the rows actually converted, and only those, so value and unit always agree.
      if (convertedSrcUnits.length > 0) {
        const unitParts: string[] = []
        if (!ambiguous) {
          unitParts.push(`        WHEN unit_concept_id IN (${[refUnitId, ...convertedSrcUnits].join(', ')}) THEN ${refUnitId}` +
            ` -- normalized to reference unit ${unitLabel(refUnitId)}`)
        } else {
          unitParts.push('        -- Conversions are concept-specific: relabel only the (concept, unit) pairs actually converted')
          for (const grp of convGroups) {
            unitParts.push(`        WHEN ${conceptCondition(grp)} AND unit_concept_id IN (${[refUnitId, ...grp.srcIds].join(', ')}) THEN ${refUnitId}`)
          }
        }
        unitConceptIdExpr = '    CASE\n' + unitParts.join('\n') +
          '\n        ELSE unit_concept_id -- no conversion for this (concept, unit): kept as-is, value stays in its original unit\n' +
          '    END AS unit_concept_id'
      }
    } else if (domain === 'Measurement' && !refUnitId) {
      lines.push('-- Note: no reference unit selected — raw value_as_number returned without conversion.')
    }

    lines.push('')
    lines.push('SELECT')
    lines.push(mapping.columns.map((col) => {
      if (valueAsNumberExpr && col === 'value_as_number') return valueAsNumberExpr
      if (unitConceptIdExpr && col === 'unit_concept_id') return unitConceptIdExpr
      return `    ${col}`
    }).join(',\n'))
    lines.push(`FROM ${mapping.table}`)
    lines.push(`WHERE ${mapping.conceptCol} IN (`)
    domainConcepts.forEach((c, idx) => {
      lines.push(`${idx === 0 ? '    ' : '   ,'}${c.conceptId} -- ${sqlComment(c.conceptName)}`)
    })
    lines.push(')')

    // The SELECT never drops a row: one in a unit that cannot be converted comes
    // back raw. This filter (live, or commented out) gives a fully normalized result.
    if (domain === 'Measurement' && refUnitId) {
      const p = dropOtherUnits ? '' : '-- '
      if (!unitConceptIdExpr) {
        lines.push(dropOtherUnits
          ? `-- Keeping only rows already in ${unitLabel(refUnitId)}, the expected unit`
          : `-- Optional: uncomment to keep only rows already in ${unitLabel(refUnitId)}, the expected unit`)
        lines.push(`${p}AND unit_concept_id = ${refUnitId}`)
      } else {
        lines.push(dropOtherUnits
          ? '-- Dropping rows whose unit cannot be converted to the reference unit'
          : '-- Optional: uncomment to drop rows whose unit cannot be converted to the reference unit')
        if (!ambiguous) {
          lines.push(`${p}AND unit_concept_id IN (${[refUnitId, ...convertedSrcUnits].join(', ')})`)
        } else {
          lines.push(`${p}AND (unit_concept_id = ${refUnitId}`)
          for (const grp of convGroups) {
            lines.push(`${p}     OR (${conceptCondition(grp)} AND unit_concept_id IN (${grp.srcIds.join(', ')}))`)
          }
          lines.push(`${p})`)
        }
      }
    }

    lines.push(';')
  }

  return lines.join('\n')
}

function conceptCondition(grp: ConversionGroup): string {
  return grp.ids.length === 1
    ? `measurement_concept_id = ${grp.ids[0]}`
    : `measurement_concept_id IN (${grp.ids.join(', ')})`
}
