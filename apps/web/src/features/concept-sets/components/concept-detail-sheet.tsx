// Layout adapted from linkr@1310cf4a4 apps/web/src/features/warehouse/concept-mapping/components/ConceptDetailSheet.tsx
// (the Details tab); links ported from legacy/concept-sets.js (showResolvedConceptDetail).
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { CopyIconButton } from '@/components/ui/copy-icon-button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SectionLabel } from '@/components/ui/section-label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { athenaUrl, fhirLookupUrl, isCustomConcept, isValidConcept } from '../lib/concept-links'
import { StandardBadge, ValidityBadge } from './badges'

/** The fields an expression item's concept and a resolved concept share. */
export interface ConceptInfo {
  conceptId: number
  conceptName: string
  vocabularyId: string
  domainId: string
  conceptClassId: string
  conceptCode: string
  standardConcept: string | null
  /** Absent on resolved concepts, which carry no validity. */
  validStartDate?: string | null
  validEndDate?: string | null
  invalidReason?: string | null
}

interface ConceptDetailSheetProps {
  concept: ConceptInfo | null
  onOpenChange: (open: boolean) => void
  /**
   * Vocabulary-powered panels under the details (hierarchy graph, related
   * concepts, synonyms). Rendered as given; empty until that feature lands.
   */
  extraContent?: ReactNode
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b py-1.5 last:border-0">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-1 text-right text-xs font-medium break-words">{children}</span>
    </div>
  )
}

function ExternalAnchor({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
      {children}
      <ExternalLink size={11} aria-hidden />
    </a>
  )
}

const hasValidity = (c: ConceptInfo) => 'invalidReason' in c || 'validStartDate' in c || 'validEndDate' in c

export function ConceptDetailSheet({ concept, onOpenChange, extraContent }: ConceptDetailSheetProps) {
  const { t } = useTranslation()
  return (
    <Sheet open={concept !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        {concept && <ConceptDetailBody concept={concept} extraContent={extraContent} />}
        {!concept && <SheetTitle className="sr-only">{t('concept_sets.concept.title')}</SheetTitle>}
      </SheetContent>
    </Sheet>
  )
}

function ConceptDetailBody({ concept, extraContent }: { concept: ConceptInfo; extraContent?: ReactNode }) {
  const { t } = useTranslation()
  const athena = athenaUrl(concept.conceptId)
  const fhir = fhirLookupUrl(concept.vocabularyId, concept.conceptCode)
  const custom = isCustomConcept(concept.conceptId)

  return (
    <>
      <SheetHeader className="shrink-0 border-b px-4 py-3">
        <SheetTitle className="pr-6 leading-tight">{concept.conceptName}</SheetTitle>
        <SheetDescription asChild>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-xs text-muted-foreground">#{concept.conceptId}</span>
            {concept.vocabularyId && <Badge variant="outline">{concept.vocabularyId}</Badge>}
            <StandardBadge standardConcept={concept.standardConcept} />
          </div>
        </SheetDescription>
      </SheetHeader>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-1 px-4 py-3">
          <DetailRow label={t('concept_sets.concept.name')}>
            <span>{concept.conceptName}</span>
            <CopyIconButton text={concept.conceptName} />
          </DetailRow>
          <DetailRow label={t('concept_sets.concept.id')}>
            {athena ? (
              <ExternalAnchor href={athena}>
                <span className="font-mono">{concept.conceptId}</span>
              </ExternalAnchor>
            ) : (
              <span className="font-mono">{concept.conceptId}</span>
            )}
            <CopyIconButton text={String(concept.conceptId)} />
          </DetailRow>
          <DetailRow label={t('concept_sets.concept.vocabulary')}>{concept.vocabularyId}</DetailRow>
          <DetailRow label={t('concept_sets.concept.code')}>
            <span className="font-mono">{concept.conceptCode}</span>
            {concept.conceptCode && <CopyIconButton text={concept.conceptCode} />}
          </DetailRow>
          <DetailRow label={t('concept_sets.concept.domain')}>{concept.domainId}</DetailRow>
          <DetailRow label={t('concept_sets.concept.class')}>{concept.conceptClassId}</DetailRow>
          <DetailRow label={t('concept_sets.concept.standard')}>
            <StandardBadge standardConcept={concept.standardConcept} />
          </DetailRow>
          {hasValidity(concept) && (
            <>
              <DetailRow label={t('concept_sets.concept.validity')}>
                <ValidityBadge valid={isValidConcept(concept.invalidReason)} invalidReason={concept.invalidReason} />
              </DetailRow>
              {(concept.validStartDate || concept.validEndDate) && (
                <DetailRow label={t('concept_sets.concept.valid_dates')}>
                  {concept.validStartDate || '…'} → {concept.validEndDate || '…'}
                </DetailRow>
              )}
            </>
          )}
          <DetailRow label={t('concept_sets.concept.fhir')}>
            {fhir ? (
              <ExternalAnchor href={fhir}>{concept.vocabularyId}</ExternalAnchor>
            ) : (
              <span className="font-normal text-muted-foreground">
                {custom ? t('concept_sets.concept.no_link_custom') : t('concept_sets.concept.no_link')}
              </span>
            )}
          </DetailRow>

          {athena && (
            <div className="pt-3">
              <ExternalAnchor href={athena}>
                <span className="text-xs">{t('concept_sets.concept.open_athena')}</span>
              </ExternalAnchor>
            </div>
          )}

          {/* TODO(vocabulary): hierarchy graph, related concepts and synonyms (v1:
              renderVocabTabs) need the OHDSI vocabularies; the vocabulary feature
              renders them through `extraContent`. */}
          {extraContent && (
            <div className="pt-4">
              <SectionLabel as="h3" className="mb-2">{t('concept_sets.concept.vocabulary_section')}</SectionLabel>
              {extraContent}
            </div>
          )}
        </div>
      </ScrollArea>
    </>
  )
}
