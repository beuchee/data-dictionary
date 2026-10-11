// Ported from legacy/app.js (normalizeConceptSetMeta, setSourceRepoOrdered,
// updateConceptSet, stampModified). The one implementation of v1's provenance
// rules in the web app, shared by exports and by drafts (static mode stamps
// with it; the server applies the same rules at submit).
import { RawNumber, type ConceptSet, type OrganizationRef } from '@data-dictionary/format'

/** Deep copy that keeps `RawNumber`s (structuredClone would turn them into plain objects). */
export function cloneContent<T>(value: T): T {
  if (value instanceof RawNumber || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(cloneContent) as T
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) out[k] = cloneContent(v)
  return out as T
}

/**
 * `metadata` with `sourceRepo` = `url`, placed right after `organization` (the
 * canonical key order; a plain assignment would append it at the end). Appended
 * when there is no `organization`. Returns a new object.
 */
export function withSourceRepo<T extends object>(metadata: T, url: string): T {
  const rebuilt: Record<string, unknown> = {}
  let placed = false
  for (const [k, v] of Object.entries(metadata)) {
    if (k === 'sourceRepo') continue
    rebuilt[k] = v
    if (k === 'organization') {
      rebuilt.sourceRepo = url
      placed = true
    }
  }
  if (!placed) rebuilt.sourceRepo = url
  return rebuilt as T
}

/**
 * A copy of `cs` in the cross-repo sharing shape: a legacy flat `organization`
 * becomes `{created, current}` (both the old value), `created` alone gets
 * `current` = `created`, and a missing `sourceRepo` defaults to `repoUrl`,
 * placed right after `organization`.
 */
export function normalizeConceptSetMeta(cs: ConceptSet, repoUrl: string): ConceptSet {
  const out = cloneContent(cs)
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
    out.metadata = withSourceRepo(m, repoUrl) as unknown as ConceptSet['metadata']
  }
  return out
}

export interface EditStamp {
  /** `YYYY-MM-DD`, stamped as `modifiedDate`. */
  date: string
  /** Stamped as `modifiedBy` when non-empty; the previous value stays otherwise. */
  modifiedBy?: string | null
  /** This dictionary's repository URL: the new `metadata.sourceRepo`. */
  repoUrl: string
  /** This instance's organization: the new `organization.current` (left alone when it has no name). */
  organization?: OrganizationRef | null
}

/**
 * A concept set as saved after an edit here (v1's `updateConceptSet` +
 * `stampModified`): this repo becomes its maintainer (`sourceRepo`), this
 * organization its current owner (`organization.current`; `created` and
 * `origin` never change), the modification is stamped, and the root
 * `name` / `description` mirror the English translation.
 */
export function stampConceptSetEdit(cs: ConceptSet, stamp: EditStamp): ConceptSet {
  const out = normalizeConceptSetMeta(cs, stamp.repoUrl)
  if (out.metadata && typeof out.metadata === 'object') {
    let metadata = out.metadata as unknown as Record<string, unknown>
    if (stamp.repoUrl && metadata.sourceRepo !== stamp.repoUrl) metadata = withSourceRepo(metadata, stamp.repoUrl)
    const org = stamp.organization
    if (org?.name) {
      const mine = { name: org.name, url: org.url ?? '' }
      const current = metadata.organization as Record<string, unknown> | null | undefined
      metadata.organization = current && typeof current === 'object' ? { ...current, current: mine } : { created: mine, current: mine }
    }
    out.metadata = metadata as unknown as ConceptSet['metadata']
    const en = out.metadata.translations?.en
    if (en) {
      if (en.name) out.name = en.name
      out.description = en.shortDescription ?? null
    }
  }
  out.modifiedDate = stamp.date
  const by = (stamp.modifiedBy ?? '').trim()
  if (by) out.modifiedBy = by
  return out
}
