import type { FileKind } from '@data-dictionary/format'
import type { Draft, DraftKind } from './types'

const SINGLE_FILES: Partial<Record<DraftKind, string>> = {
  'recommended-units': 'units/recommended_units.json',
  'unit-conversions': 'units/unit_conversions.json',
  'mapping-recommendations': 'mapping_recommendations/mapping_recommendations.json',
  config: 'config.json',
}

/** The file a draft replaces, relative to the repository root. */
export function draftFilePath(kind: DraftKind, id: number | null): string {
  if (kind === 'concept-set') return `concept_sets/${id}.json`
  if (kind === 'project') return `projects/${id}.json`
  return SINGLE_FILES[kind] as string
}

/** The format package's kind for a draft (same names: drafts only cover content files). */
export function draftFileKind(kind: DraftKind): FileKind {
  return kind
}

/** A draft creating a concept set or project that the repository does not have yet. */
export function isNewDraft(draft: Pick<Draft, 'kind' | 'targetId'>): boolean {
  return (draft.kind === 'concept-set' || draft.kind === 'project') && draft.targetId === null
}

/** The id a draft is shown under: its target, else the provisional id of its content. */
export function draftEntityId(draft: Draft): number | null {
  if (draft.targetId !== null) return draft.targetId
  if (draft.kind === 'concept-set' || draft.kind === 'project') return draft.content.id
  return null
}
