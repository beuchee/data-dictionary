// Ported from legacy/concept-sets.js (buildIndicateJSON) and legacy/app.js
// (toolTag, stampModified, normalizeConceptSetMeta). Same JSON as v1
// (indicate-json.test.ts), written by the format package's `serialize`: the
// canonical bytes of a concept_sets/ file, i.e. v1's output plus a final newline.
import { RawNumber, serialize, type ConceptSet } from '@data-dictionary/format'

/** The app (not the fork's dictionary) stamped as the tool that wrote an export. */
export const APP_NAME = 'INDICATE Data Dictionary'
export const APP_REPOSITORY_URL = 'https://github.com/indicate-eu/data-dictionary'

/** `INDICATE Data Dictionary v<version> (<url>)`, written to `createdByTool` and SQL headers. */
export function toolTag(appVersion: string): string {
  return `${APP_NAME} v${appVersion} (${APP_REPOSITORY_URL})`
}

export interface IndicateJsonOptions {
  /** See `toolTag`. */
  toolTag: string
  /** `YYYY-MM-DD`, stamped as `modifiedDate`. */
  date: string
  /** Stamped as `modifiedBy` when non-empty; the previous value stays otherwise. */
  modifiedBy?: string | null
  /** This dictionary's repository URL, the default `metadata.sourceRepo`. */
  repoUrl: string
}

/** Deep copy that keeps `RawNumber`s (structuredClone would turn them into plain objects). */
function clone<T>(value: T): T {
  if (value instanceof RawNumber || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(clone) as T
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) out[k] = clone(v)
  return out as T
}

/**
 * A copy of `cs` in the cross-repo sharing shape: a legacy flat `organization`
 * becomes `{created, current}` (both the old value), `created` alone gets
 * `current` = `created`, and a missing `sourceRepo` defaults to `repoUrl`,
 * placed right after `organization`.
 */
export function normalizeConceptSetMeta(cs: ConceptSet, repoUrl: string): ConceptSet {
  const out = clone(cs)
  const m = out.metadata as unknown as Record<string, unknown> | undefined
  if (!m || typeof m !== 'object') return out
  const o = m.organization as Record<string, unknown> | null | undefined
  if (o && typeof o === 'object' && !('created' in o) && !('current' in o)) {
    m.organization = {
      created: { name: (o.name as string) || '', url: (o.url as string) || '' },
      current: { name: (o.name as string) || '', url: (o.url as string) || '' },
    }
  } else if (o && typeof o === 'object' && 'created' in o && !('current' in o)) {
    m.organization = { created: o.created, current: o.created }
  }
  if (m.sourceRepo === undefined || m.sourceRepo === null) {
    const rebuilt: Record<string, unknown> = {}
    let placed = false
    for (const [k, v] of Object.entries(m)) {
      if (k === 'sourceRepo') continue
      rebuilt[k] = v
      if (k === 'organization') {
        rebuilt.sourceRepo = repoUrl
        placed = true
      }
    }
    if (!placed) rebuilt.sourceRepo = repoUrl
    out.metadata = rebuilt as unknown as ConceptSet['metadata']
  }
  return out
}

/** The set as exported: normalized, `createdByTool` = tool tag, modification stamped. */
export function stampIndicateExport(cs: ConceptSet, options: IndicateJsonOptions): ConceptSet {
  const out = normalizeConceptSetMeta(cs, options.repoUrl)
  out.createdByTool = options.toolTag
  out.modifiedDate = options.date
  const by = (options.modifiedBy ?? '').trim()
  if (by) out.modifiedBy = by
  return out
}

/** The INDICATE JSON of `cs`, ready to be dropped into `concept_sets/{id}.json`. */
export function buildIndicateJson(cs: ConceptSet, options: IndicateJsonOptions): string {
  return serialize(stampIndicateExport(cs, options), { kind: 'concept-set' })
}
