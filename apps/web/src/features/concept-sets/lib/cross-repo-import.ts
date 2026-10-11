// Ported from legacy/concept-sets.js (resolveRepoUrls, toRawFileUrl, importFetchRepo,
// importFetchSingle, classifyImport, buildSingleCandidate, importRowFields,
// importOneCandidate, importPastedSingle): importing concept sets from another
// dictionary repository, keyed on the lineage id `metadata.uniqueId`.
import { normalizeOrganization } from '@/lib/data/catalog'
import { cloneContent, normalizeConceptSetMeta, withSourceRepo } from '@/lib/export/provenance'
import type { ConceptSet, OrganizationRef } from '@data-dictionary/format'

// --- Where to fetch ------------------------------------------------------------

export interface RepoUrls {
  /** Catalogs to try in order (a Pages site, a v2 static build, a raw tree). */
  dataJson: string[]
  /** The repository's `concept_sets_versions.json` (`{id: {version: sha}}`); null when it can't be derived. */
  versions: string | null
}

const trimUrl = (url: string) => url.trim().replace(/\/+$/, '')

/**
 * The catalog and version index URLs of a dictionary, from what the user
 * pasted: a GitHub / GitLab repository (its Pages site serves the built
 * catalog, the raw tree the index), a direct `data.json`, a Pages site or any
 * other host. v1 tried the site root and `docs/`; v2 static builds serve
 * `data/data.json` and the repo keeps the v1 build under `legacy/`.
 */
export function resolveRepoUrls(input: string): RepoUrls | null {
  const u = trimUrl(input)
  if (!u || !/^https?:\/\//i.test(u)) return null
  if (/data\.json($|\?)/.test(u)) return { dataJson: [u], versions: null }

  const gh = /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(u)
  if (gh) {
    const site = `https://${gh[1].toLowerCase()}.github.io/${gh[2]}`
    const raw = `https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/main/`
    return {
      dataJson: [`${site}/data.json`, `${site}/data/data.json`, `${raw}docs/data.json`, `${raw}legacy/data.json`],
      versions: `${raw}concept_sets_versions.json`,
    }
  }
  const gl = /^https?:\/\/gitlab\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(u)
  if (gl) {
    const site = `https://${gl[1].toLowerCase()}.gitlab.io/${gl[2]}`
    const raw = `https://gitlab.com/${gl[1]}/${gl[2]}/-/raw/main/`
    return {
      dataJson: [`${site}/data.json`, `${site}/data/data.json`, `${raw}docs/data.json`, `${raw}legacy/data.json`],
      versions: `${raw}concept_sets_versions.json`,
    }
  }
  if (/\/(docs|legacy)$/.test(u)) {
    return { dataJson: [`${u}/data.json`], versions: `${u.replace(/\/(docs|legacy)$/, '')}/concept_sets_versions.json` }
  }
  return {
    dataJson: [`${u}/data.json`, `${u}/data/data.json`, `${u}/docs/data.json`, `${u}/legacy/data.json`],
    versions: `${u}/concept_sets_versions.json`,
  }
}

/**
 * A forge's "view file" page (HTML) → the raw file it shows:
 * `github.com/o/r/blob/ref/p` → `raw.githubusercontent.com/o/r/ref/p`,
 * `gitlab.com/o/r/-/blob/ref/p` → `gitlab.com/o/r/-/raw/ref/p`.
 */
export function toRawFileUrl(url: string): string {
  const u = url.trim()
  const gh = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/i.exec(u)
  if (gh) return `https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/${gh[3]}`
  const gl = /^https?:\/\/gitlab\.com\/(.+?)\/-\/blob\/(.+)$/i.exec(u)
  if (gl) return `https://gitlab.com/${gl[1]}/-/raw/${gl[2]}`
  return u
}

/** Best-effort source repository of a single file URL (`…/<repo>/main/concept_sets/10.json`). */
export function sourceRepoOfFileUrl(rawUrl: string): string {
  return rawUrl.replace(/\/?(docs\/)?concept_sets\/.*$/, '').replace(/\/-?\/?raw\/[^/]+$/, '')
}

/**
 * The repository to credit as the source of a catalog: its own configured URL
 * (`repository.url`, else `upstream`), else what the user typed without any
 * `data.json` suffix. A bare `repo` slug carries no host, so it is not guessed.
 */
export function catalogSourceRepo(config: unknown, typed: string): string {
  const c = (config && typeof config === 'object' ? config : {}) as Record<string, unknown>
  const repo = (c.repository ?? c.github) as Record<string, unknown> | undefined
  const fromConfig = (typeof repo?.url === 'string' && repo.url) || (typeof repo?.upstream === 'string' && repo.upstream) || ''
  if (fromConfig) return fromConfig.replace(/\.git$/, '')
  return trimUrl(typed).replace(/\/?((docs|legacy|data)\/)?data\.json($|\?.*)/, '')
}

// --- Classification ----------------------------------------------------------------

export type ImportStatus = 'new' | 'up_to_date' | 'conflict'

/** What this dictionary already holds, by lineage: repository sets and the user's drafts. */
export interface LocalSet {
  id: number
  uniqueId: string | null
  version: string
}

export interface Classification {
  status: ImportStatus
  /** The local set with the same lineage. */
  localId: number | null
}

/**
 * `new` (no local set of that lineage), `up_to_date` (same version: skip) or
 * `conflict` (another version: overwrite the local copy, keeping its id). A
 * set without `uniqueId` is always new.
 */
export function classifyImport(cs: Pick<ConceptSet, 'version'> & { metadata?: { uniqueId?: string | null } | null }, local: readonly LocalSet[]): Classification {
  const uid = cs.metadata?.uniqueId
  if (!uid) return { status: 'new', localId: null }
  const match = local.find((l) => l.uniqueId === uid)
  if (!match) return { status: 'new', localId: null }
  if ((match.version || '') === (cs.version || '')) return { status: 'up_to_date', localId: match.id }
  return { status: 'conflict', localId: match.id }
}

/** Repository sets overridden by the user's drafts (a draft may carry a newer version, or a new lineage). */
export function localSets(repository: readonly LocalSet[], drafts: readonly LocalSet[]): LocalSet[] {
  const byId = new Map(repository.map((s) => [s.id, s]))
  for (const d of drafts) byId.set(d.id, d)
  return [...byId.values()]
}

export interface ImportCandidate {
  cs: ConceptSet
  sourceRepoUrl: string
  /** The commit that introduced this version in the source (its versions index); null when unknown. */
  sourceCommit: string | null
  status: ImportStatus
  localId: number | null
  selected: boolean
}

export type VersionsIndex = Record<string, Record<string, string>>

/** Whether a value looks like a concept set of this format (v1 only checked `metadata`). */
export function isConceptSetLike(value: unknown): value is ConceptSet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return !!v.metadata && typeof v.metadata === 'object'
}

/** The candidates of a fetched catalog (`data.json`), new ones selected. */
export function catalogCandidates(
  data: unknown,
  index: VersionsIndex | null,
  sourceRepoUrl: string,
  local: readonly LocalSet[],
): ImportCandidate[] {
  const sets = (data && typeof data === 'object' ? (data as { conceptSets?: unknown }).conceptSets : null) ?? []
  if (!Array.isArray(sets)) return []
  return sets.filter(isConceptSetLike).map((cs) => {
    const c = classifyImport(cs, local)
    const versions = index?.[String(cs.id)] ?? {}
    return {
      cs,
      sourceRepoUrl,
      sourceCommit: (cs.version && versions[cs.version]) || null,
      status: c.status,
      localId: c.localId,
      selected: c.status === 'new',
    }
  })
}

/** One set (a URL or pasted JSON): selected unless already up to date. */
export function singleCandidate(cs: ConceptSet, sourceRepoUrl: string, local: readonly LocalSet[]): ImportCandidate {
  const c = classifyImport(cs, local)
  return { cs, sourceRepoUrl, sourceCommit: null, status: c.status, localId: c.localId, selected: c.status !== 'up_to_date' }
}

// --- Rows -------------------------------------------------------------------------

export interface CandidateRow {
  index: number
  name: string
  category: string
  subcategory: string
  version: string
  /** The authoring organization (`organization.created`). */
  organization: string
  description: string
  status: ImportStatus
}

/** What the results table shows of a candidate, in `lang` (no fallback but v1's `name` / `#id`). */
export function candidateRow(c: ImportCandidate, index: number, lang: string): CandidateRow {
  const cs = c.cs
  const tr = cs.metadata?.translations?.[lang] ?? {}
  return {
    index,
    name: tr.name || cs.name || `#${cs.id}`,
    category: tr.category || '',
    subcategory: tr.subcategory || '',
    version: cs.version || '',
    organization: createdOrganization(cs)?.name || '',
    description: tr.shortDescription || cs.description || '',
    status: c.status,
  }
}

export function createdOrganization(cs: ConceptSet): OrganizationRef | null {
  return normalizeOrganization(cs.metadata?.organization)?.created ?? null
}

// --- Import ---------------------------------------------------------------------

export interface ImportContext {
  /** This dictionary's organization: the copy's new `organization.current`. */
  organization: OrganizationRef
  /** This dictionary's repository URL: the copy's new `sourceRepo`. */
  repoUrl: string
  /** `YYYY-MM-DD`. */
  today: string
}

/** `metadata` with `origin` set, at its canonical place (after `reviewStatus`) when it was absent. */
function withOrigin(metadata: Record<string, unknown>, origin: Record<string, unknown>): Record<string, unknown> {
  if ('origin' in metadata) return { ...metadata, origin }
  const out: Record<string, unknown> = {}
  let placed = false
  for (const [k, v] of Object.entries(metadata)) {
    out[k] = v
    if (k === 'reviewStatus') {
      out.origin = origin
      placed = true
    }
  }
  if (!placed) out.origin = origin
  return out
}

/**
 * The local copy of an imported set (v1's `importOneCandidate`): its lineage
 * (`uniqueId`) and author (`organization.created`) kept, `origin` written
 * once with where it came from (frozen afterwards), this organization its
 * current owner and this repository its maintainer, under `localId`.
 */
export function importedCopy(c: ImportCandidate, localId: number, ctx: ImportContext): ConceptSet {
  const cs = normalizeConceptSetMeta(cloneContent(c.cs), c.cs.metadata?.sourceRepo || c.sourceRepoUrl || '')
  const m = cs.metadata as unknown as Record<string, unknown>
  const origin = {
    uniqueId: (m.uniqueId as string) || null,
    repo: c.sourceRepoUrl || (m.sourceRepo as string) || '',
    version: cs.version || null,
    commit: c.sourceCommit || null,
    organization: createdOrganization(cs),
    importedDate: ctx.today,
  }
  let metadata = withOrigin(m, origin)
  const mine = { name: ctx.organization.name, url: ctx.organization.url ?? '' }
  const org = metadata.organization as Record<string, unknown> | null | undefined
  metadata.organization = org && typeof org === 'object' ? { ...org, current: mine } : { created: mine, current: mine }
  metadata = withSourceRepo(metadata, ctx.repoUrl)
  cs.metadata = metadata as unknown as ConceptSet['metadata']
  cs.id = localId
  return cs
}

// --- Fetching ---------------------------------------------------------------------

export type FetchJson = (url: string) => Promise<unknown>

/** The first catalog that answers, with the URL it came from; the last error otherwise. */
export async function fetchFirst(urls: readonly string[], fetchJson: FetchJson): Promise<{ url: string; data: unknown }> {
  let lastError: unknown = new Error('No URL to fetch')
  for (const url of urls) {
    try {
      const data = await fetchJson(url)
      if (data && typeof data === 'object' && Array.isArray((data as { conceptSets?: unknown }).conceptSets)) return { url, data }
      lastError = new Error(`${url}: not a dictionary catalog`)
    } catch (e) {
      lastError = e
    }
  }
  throw lastError
}

/** A catalog's candidates from a repository URL (v1's `importFetchRepo`). */
export async function fetchRepoCandidates(input: string, local: readonly LocalSet[], fetchJson: FetchJson): Promise<ImportCandidate[]> {
  const urls = resolveRepoUrls(input)
  if (!urls) throw new Error('invalid_url')
  const [{ data }, index] = await Promise.all([
    fetchFirst(urls.dataJson, fetchJson),
    // Optional: it only fills `origin.commit`.
    urls.versions ? fetchJson(urls.versions).catch(() => null) : Promise.resolve(null),
  ])
  const versions = index && typeof index === 'object' && !Array.isArray(index) ? (index as VersionsIndex) : null
  return catalogCandidates(data, versions, catalogSourceRepo((data as { config?: unknown }).config, input), local)
}

/** One set from a file URL (a forge's view page is turned into its raw file). */
export async function fetchSingleCandidate(input: string, local: readonly LocalSet[], fetchJson: FetchJson): Promise<ImportCandidate> {
  const url = toRawFileUrl(input)
  if (!/^https?:\/\//i.test(url)) throw new Error('invalid_url')
  const cs = await fetchJson(url)
  if (!isConceptSetLike(cs)) throw new Error('not_a_concept_set')
  return singleCandidate(cs, sourceRepoOfFileUrl(url), local)
}

/** One pasted set: credited to its own `sourceRepo`. */
export function pastedCandidate(text: string, local: readonly LocalSet[]): ImportCandidate {
  let cs: unknown
  try {
    cs = JSON.parse(text)
  } catch {
    throw new Error('invalid_json')
  }
  if (!isConceptSetLike(cs)) throw new Error('not_a_concept_set')
  return singleCandidate(cs, cs.metadata?.sourceRepo || '', local)
}
