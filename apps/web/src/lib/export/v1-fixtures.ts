// Test-only: reads the v1 goldens and the content they were generated from
// (__fixtures__/v1, see scripts/generate-v1-goldens.mjs). Imported by *.test.ts only.
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import type {
  ConceptSet,
  Project,
  RecommendedUnit,
  ResolvedConcept,
  ResolvedConceptSet,
  UnitConversion,
} from '@data-dictionary/format'

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__/v1')

export const readGolden = (rel: string): string => readFileSync(path.join(DIR, rel), 'utf-8')
const readJson = <T>(rel: string): T => JSON.parse(readGolden(rel)) as T

export interface SqlCase {
  conceptSetId: number
  why: string
  lang: string
  dropOtherUnits: boolean
  referenceUnitId: number | null
  isDefault: boolean
  unitOptions: { unitId: number; label: string }[]
  file: string
}

export interface V1Cases {
  date: string
  siteBase: string
  toolTag: string
  repoUrl: string
  sql: SqlCase[]
  atlas: { conceptSetId: number; file: string }[]
  indicate: { conceptSetId: number; modifiedBy: string | null; file: string }[]
  projectCsv: { projectId: number; lang: string; filename: string; file: string }[]
  pinned: { id: number; version: string }[]
}

export const cases = readJson<V1Cases>('cases.json')

export const conceptSet = (id: number): ConceptSet => readJson(`inputs/concept_sets/${id}.json`)

export function resolved(id: number): ResolvedConcept[] {
  try {
    return readJson<ResolvedConceptSet>(`inputs/concept_sets_resolved/${id}.json`).resolvedConcepts
  } catch {
    return []
  }
}

export const project = (id: number): Project => readJson(`inputs/projects/${id}.json`)
export const unitConversions = readJson<UnitConversion[]>('inputs/unit_conversions.json')
export const recommendedUnits = readJson<RecommendedUnit[]>('inputs/recommended_units.json')

/** v1's lookup: the current file for the current version, else the pinned snapshot. */
export function pinnedLookup(id: number, version: string | undefined): ConceptSet | null {
  let current: ConceptSet | null = null
  try {
    current = conceptSet(id)
  } catch {
    current = null
  }
  if (!version || current?.version === version) return current
  return cases.pinned.some((p) => p.id === id && p.version === version)
    ? readJson<ConceptSet>(`inputs/pinned/${id}@${version}.json`)
    : null
}

/** v1's permalink (hash route), so the SQL header matches the goldens. */
export function v1Permalink(cs: ConceptSet): string {
  let url = `${cases.siteBase}#/concept-sets?id=${cs.id}`
  if (cs.version) url += `&version=${encodeURIComponent(cs.version)}`
  return url
}
