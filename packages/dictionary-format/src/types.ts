/**
 * TypeScript shapes of the content files, matching schemas/*.schema.json.
 *
 * Every object is open (`[key: string]: unknown`): unknown fields written by a
 * fork or a later version must survive a read/write cycle untouched. Fields
 * typed `JsonNumber` are where `parse` can hand back a `RawNumber` (e.g. `1.0`).
 */
import type { JsonNumber } from './number.ts'

type Open = { [key: string]: unknown }

/** BCP 47 language code (`en`, `fr`, `pt-BR`…) → per-language object. */
export type Translations<T> = Record<string, T>

export type ReviewStatus = 'draft' | 'pending_review' | 'approved' | 'needs_revision' | 'deprecated'
export const REVIEW_STATUSES: readonly ReviewStatus[] = ['draft', 'pending_review', 'approved', 'needs_revision', 'deprecated']

/** 'S' Standard, 'C' Classification, null Non-standard ('' is a legacy spelling of null). */
export type StandardConcept = 'S' | 'C' | null | ''

export type GroupRule = 'all_required' | 'at_least_one' | 'optional'
export const GROUP_RULES: readonly GroupRule[] = ['all_required', 'at_least_one', 'optional']

// --- Concept set ----------------------------------------------------------

export interface ConceptRef extends Open {
  conceptId: number
  conceptName: string
  domainId: string
  vocabularyId: string
  conceptClassId: string
  standardConcept: StandardConcept
  standardConceptCaption?: string | null
  conceptCode: string
  /** `YYYY-MM-DD`, legacy `YYYYMMDD`, or ''. */
  validStartDate?: string | null
  validEndDate?: string | null
  invalidReason?: string | null
  invalidReasonCaption?: string | null
}

export interface ExpressionItem extends Open {
  concept: ConceptRef
  isExcluded: boolean
  includeDescendants: boolean
  includeMapped: boolean
}

export interface OrganizationRef extends Open {
  name: string
  url?: string | null
}

/** Current shape; the legacy flat `{name, url}` is `OrganizationRef`. */
export interface Organization extends Open {
  created: OrganizationRef
  current?: OrganizationRef
}

export interface ConceptSetTranslation extends Open {
  name?: string | null
  category?: string | null
  subcategory?: string | null
  /** One line, plain text. */
  shortDescription?: string | null
  /** Markdown. */
  longDescription?: string | null
}

export interface Person extends Open {
  firstName?: string | null
  lastName?: string | null
  affiliation?: string | null
  profession?: string | null
  orcid?: string | null
}

export interface Review extends Open {
  reviewId?: number | string
  reviewer: Person
  reviewTimestamp?: string
  status?: ReviewStatus
  comments?: string | null
  version: string
}

export interface VersionEntry extends Open {
  version: string
  date?: string
  author?: string | null
  message?: string | null
}

export interface Origin extends Open {
  uniqueId: string
  repo: string
  version: string
  commit?: string | null
  organization?: unknown
  importedDate?: string | null
}

export interface ConceptSetMetadata extends Open {
  uniqueId: string
  organization: Organization | OrganizationRef
  /** Absent on legacy sets (readers default it to this repo). */
  sourceRepo?: string | null
  reviewStatus: ReviewStatus
  /** Absent on legacy sets; null when created here. */
  origin?: Origin | null
  translations: Translations<ConceptSetTranslation>
  createdByDetails: Person | null
  reviews: Review[]
  versions: VersionEntry[]
  distributionStats: Open | null
}

export interface ConceptSet extends Open {
  id: number
  name: string
  description: string | null
  version: string
  createdBy: string | null
  createdDate: string
  modifiedBy: string | null
  modifiedDate: string
  createdByTool: string | null
  expression: { items: ExpressionItem[] } & Open
  tags: unknown[]
  metadata: ConceptSetMetadata
}

// --- Resolved concept set -------------------------------------------------

export interface ResolvedConcept extends Open {
  conceptId: number
  conceptName: string
  vocabularyId: string
  domainId: string
  conceptClassId: string
  conceptCode: string
  standardConcept: StandardConcept
}

export interface ResolvedConceptSet extends Open {
  conceptSetId: number
  /** `{release, <vocabularyId>: <vocabulary_version>}` or null. */
  vocabularyVersion: Record<string, string | null> | null
  resolvedConcepts: ResolvedConcept[]
}

// --- Project --------------------------------------------------------------

export interface PinnedConceptSet extends Open {
  id: number
  version: string
}

export interface ProjectGroup extends Open {
  id: string
  translations?: Translations<{ name?: string | null } & Open>
  /** Legacy field-first name. */
  name?: string | Record<string, string>
  rule: GroupRule
  conceptSets: PinnedConceptSet[]
}

export interface ProjectTranslation extends Open {
  name?: string | null
  shortDescription?: string | null
  longDescription?: string | null
}

export interface Project extends Open {
  id: number
  translations: Translations<ProjectTranslation>
  createdBy?: string | null
  createdDate?: string
  modifiedDate?: string
  groups?: ProjectGroup[]
  /** Legacy flat list, read as one default group. */
  conceptSets?: PinnedConceptSet[]
  /** Oldest legacy shape: ids read at their latest version. */
  conceptSetIds?: number[]
}

// --- Units ----------------------------------------------------------------

export interface RecommendedUnit extends Open {
  conceptId: number
  conceptName: string
  conceptCode: string
  vocabularyId: string
  domainId: string
  recommendedUnitConceptId: number
  recommendedUnitName: string
  recommendedUnitCode: string
  recommendedUnitVocabularyId: string
}
export type RecommendedUnits = RecommendedUnit[]

/** target = source × conversionFactor + offset. */
export interface UnitConversion extends Open {
  conceptId: number
  conceptName: string
  sourceUnitConceptId: number
  sourceUnitCode: string
  sourceUnitName: string
  conversionFactor: JsonNumber
  offset?: JsonNumber
  targetUnitConceptId: number
  targetUnitCode: string
  targetUnitName: string
}
export type UnitConversions = UnitConversion[]

// --- Others ---------------------------------------------------------------

export interface MappingRecommendations extends Open {
  translations: Translations<{ content: string | null } & Open>
}

export interface RepositoryConfig extends Open {
  url?: string
  repo?: string
  branch?: string
  upstream?: string
  upstreamBranch?: string
  forge?: string
}

export interface BrandingColors extends Open {
  primary?: string
  secondary?: string
  accent?: string
}

export interface Config extends Open {
  title: string
  languages: string[]
  defaultLanguage?: string
  repository?: RepositoryConfig
  /** Legacy name of `repository` (before v1.2.6). */
  github?: RepositoryConfig
  organization?: { name?: string; url?: string | null } & Open
  customVocabulary?: { id?: string; codePrefix?: string } & Open
  branding?: {
    logo?: string | null
    favicon?: string | null
    logoAlt?: string | null
    appName?: string
    colors?: BrandingColors
    darkColors?: BrandingColors
    font?: string
  } & Open
  tabs?: { showProjects?: boolean; showMappingRecommendations?: boolean } & Open
  access?: { anonymousRead?: boolean } & Open
}

/** `{conceptSetId: {version: commitSha}}`. */
export type ConceptSetVersionsIndex = Record<string, Record<string, string>>

export interface IdCounters extends Open {
  nextConceptSetId: number
  nextProjectId: number
}

/** File kind → its TypeScript shape. */
export interface FileKindTypes {
  'concept-set': ConceptSet
  'concept-set-resolved': ResolvedConceptSet
  project: Project
  'recommended-units': RecommendedUnits
  'unit-conversions': UnitConversions
  'mapping-recommendations': MappingRecommendations
  config: Config
  'concept-sets-versions': ConceptSetVersionsIndex
  'id-counters': IdCounters
}
