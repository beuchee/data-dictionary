import type {
  Config,
  ConceptSet,
  MappingRecommendations,
  Project,
  RecommendedUnits,
  UnitConversions,
} from '@data-dictionary/format'

/** What a draft replaces (docs/design/drafts-and-proposals.md). */
export const DRAFT_KINDS = [
  'concept-set',
  'project',
  'recommended-units',
  'unit-conversions',
  'mapping-recommendations',
  'config',
] as const

export type DraftKind = (typeof DRAFT_KINDS)[number]

export interface DraftContentByKind {
  'concept-set': ConceptSet
  project: Project
  'recommended-units': RecommendedUnits
  'unit-conversions': UnitConversions
  'mapping-recommendations': MappingRecommendations
  config: Config
}

interface DraftBase {
  id: string
  /**
   * The content id it replaces; null for a new concept set or project (the id in
   * `content.id` is then provisional: the server allocates the real one at submit)
   * and for the single-file kinds.
   */
  targetId: number | null
  /** Content-repo HEAD the edit started from; null when unknown (static mode). */
  baseCommit: string | null
  createdAt: string
  updatedAt: string
}

/** A full replacement of one content file, not yet submitted. */
export type Draft = {
  [K in DraftKind]: DraftBase & { kind: K; content: DraftContentByKind[K] }
}[DraftKind]

export type DraftOf<K extends DraftKind> = Extract<Draft, { kind: K }>

export interface NewDraft<K extends DraftKind = DraftKind> {
  kind: K
  targetId: number | null
  baseCommit?: string | null
  content: DraftContentByKind[K]
}

export type SubmitMode = 'proposal' | 'commit'

/** `POST /drafts/{id}/submit` answer. */
export interface SubmitResult {
  mode: SubmitMode
  commitSha: string
  branch?: string | null
  /** The PR (GitHub) or MR (GitLab) opened for a proposal. */
  proposalUrl?: string | null
  /** The id allocated to a new concept set. */
  conceptSetId?: number | null
}

/**
 * Where drafts live: the API (server mode) or this browser's IndexedDB (static
 * mode). `get` resolves to null for an unknown id; every other failure rejects.
 */
export interface DraftStore {
  readonly mode: 'server' | 'static'
  list(): Promise<Draft[]>
  get(id: string): Promise<Draft | null>
  create<K extends DraftKind>(draft: NewDraft<K>): Promise<DraftOf<K>>
  update<K extends DraftKind>(id: string, content: DraftContentByKind[K]): Promise<DraftOf<K>>
  remove(id: string): Promise<void>
}
