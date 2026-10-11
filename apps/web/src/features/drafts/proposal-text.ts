import { serialize } from '@data-dictionary/format'
import { buildIndicateJson, buildProjectJson, type IndicateJsonOptions } from '@/lib/export'
import type { Draft } from '@/lib/drafts/types'

/**
 * The file text a static-mode proposal hands to the forge: a concept set as
 * its INDICATE JSON (tool tag and modification stamped, as v1), anything else
 * as its canonical file.
 */
export function proposalText(draft: Draft, options: IndicateJsonOptions): string {
  if (draft.kind === 'concept-set') return buildIndicateJson(draft.content, options)
  if (draft.kind === 'project') return buildProjectJson(draft.content)
  return serialize(draft.content, { kind: draft.kind })
}
