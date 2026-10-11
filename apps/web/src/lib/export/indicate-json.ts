// Ported from legacy/concept-sets.js (buildIndicateJSON) and legacy/app.js
// (toolTag, stampModified, normalizeConceptSetMeta). Same JSON as v1
// (indicate-json.test.ts), written by the format package's `serialize`: the
// canonical bytes of a concept_sets/ file, i.e. v1's output plus a final newline.
import { serialize, type ConceptSet } from '@data-dictionary/format'
import { normalizeConceptSetMeta } from './provenance'

export { normalizeConceptSetMeta }

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
