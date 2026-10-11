import { draftEntityId, isNewDraft } from '@/lib/drafts/paths'
import type { Draft } from '@/lib/drafts/types'

/** The name a draft is listed under in `lang` (no fallback to another language); null when it has none. */
export function draftLabel(draft: Draft, lang: string): string | null {
  if (draft.kind === 'concept-set') return draft.content.metadata?.translations?.[lang]?.name || null
  if (draft.kind === 'project') return draft.content.translations?.[lang]?.name || null
  return null
}

/** Where a draft is edited in the app. */
export function draftHref(draft: Draft): string {
  const id = draftEntityId(draft)
  switch (draft.kind) {
    case 'concept-set':
      return `/concept-sets/${id}`
    case 'project':
      return `/projects/${id}`
    case 'mapping-recommendations':
      return '/mapping'
    case 'recommended-units':
    case 'unit-conversions':
      return '/settings/units'
    case 'config':
      return '/settings'
  }
}

const NOUN: Record<Draft['kind'], string> = {
  'concept-set': 'concept set',
  project: 'project',
  'recommended-units': 'recommended units',
  'unit-conversions': 'unit conversions',
  'mapping-recommendations': 'mapping recommendations',
  config: 'configuration',
}

/**
 * The commit message offered by default, in English like every commit of the
 * content repo: `Add concept set "Heart rate"`, `Update project 3 "MIMIC-EU"`,
 * `Review concept set 12 "Heart rate"`.
 */
export function defaultSubmitMessage(draft: Draft, options: { reviewsOnly?: boolean } = {}): string {
  const name = draftLabel(draft, 'en')
  const quoted = name ? ` "${name}"` : ''
  if (draft.kind !== 'concept-set' && draft.kind !== 'project') return `Update ${NOUN[draft.kind]}`
  if (isNewDraft(draft)) return `Add ${NOUN[draft.kind]}${quoted}`
  const verb = options.reviewsOnly ? 'Review' : 'Update'
  return `${verb} ${NOUN[draft.kind]} ${draftEntityId(draft)}${quoted}`
}
