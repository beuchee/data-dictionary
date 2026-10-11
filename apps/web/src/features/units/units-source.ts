import { parse, type RecommendedUnits, type UnitConversions } from '@data-dictionary/format'
import { apiFetch, isServerMode } from '@/lib/api-client'
import type { UnitsKind } from './unit-rows'

export interface UnitsFileByKind {
  'unit-conversions': UnitConversions
  'recommended-units': RecommendedUnits
}

const API_PATH: Record<UnitsKind, string> = {
  'unit-conversions': '/api/v1/units/conversions',
  'recommended-units': '/api/v1/units/recommended',
}

const PAYLOAD_KEY: Record<UnitsKind, 'unitConversions' | 'recommendedUnits'> = {
  'unit-conversions': 'unitConversions',
  'recommended-units': 'recommendedUnits',
}

/** The rows of a units file from a static payload (`data.json`) parsed losslessly. */
export function unitsFromPayload<K extends UnitsKind>(payload: unknown, kind: K): UnitsFileByKind[K] {
  const rows = (payload as Record<string, unknown> | null)?.[PAYLOAD_KEY[kind]]
  return (Array.isArray(rows) ? rows : []) as UnitsFileByKind[K]
}

/**
 * The repository's units file, parsed **losslessly**: the catalog store reads
 * it with `JSON.parse`, which turns the file's `1.0` factors into `1`, and an
 * edit saved from those rows would rewrite every such line. The API sends the
 * lexemes as stored; the static payload (`build.py`) keeps them too.
 */
export async function loadUnitsFile<K extends UnitsKind>(kind: K): Promise<UnitsFileByKind[K]> {
  if (isServerMode()) {
    const res = await apiFetch(API_PATH[kind])
    if (!res.ok) throw new Error(`${API_PATH[kind]}: HTTP ${res.status}`)
    return parse<UnitsFileByKind[K]>(await res.text())
  }
  const res = await fetch(`${import.meta.env.BASE_URL}data/data.json`)
  if (!res.ok) throw new Error(`data/data.json: HTTP ${res.status}`)
  return unitsFromPayload(parse(await res.text()), kind)
}
