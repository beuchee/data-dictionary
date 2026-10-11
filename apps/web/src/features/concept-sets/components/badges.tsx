import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { standardKind } from '../lib/concept-links'
import type { ReviewStatus } from '@data-dictionary/format'

// Status colors carry meaning (v1's palette), so they are fixed rather than themed.
const STATUS_CLASS: Record<ReviewStatus, string> = {
  draft: 'bg-slate-500 text-white',
  pending_review: 'bg-amber-400 text-black',
  approved: 'bg-green-600 text-white',
  needs_revision: 'bg-orange-500 text-white',
  deprecated: 'bg-red-600 text-white',
}

function isReviewStatus(value: unknown): value is ReviewStatus {
  return typeof value === 'string' && Object.hasOwn(STATUS_CLASS, value)
}

interface StatusBadgeProps {
  status: string | null | undefined
  className?: string
}

/** A review status slug as a colored badge; an unknown value shows as-is, outlined. */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  const { t } = useTranslation()
  if (!status) return null
  if (!isReviewStatus(status)) return <Badge variant="outline" className={className}>{status}</Badge>
  return <Badge className={cn(STATUS_CLASS[status], className)}>{t(`concept_sets.status.${status}`)}</Badge>
}

interface StandardBadgeProps {
  standardConcept: string | null | undefined
  className?: string
}

/** 'S' Standard, 'C' Classification, anything else Non-standard (badge from `standardConcept`, never the caption). */
export function StandardBadge({ standardConcept, className }: StandardBadgeProps) {
  const { t } = useTranslation()
  const kind = standardKind(standardConcept)
  if (kind === 'standard') {
    return <Badge className={cn('bg-green-600 text-white', className)}>{t('concept_sets.standard.standard')}</Badge>
  }
  if (kind === 'classification') {
    return <Badge variant="secondary" className={className}>{t('concept_sets.standard.classification')}</Badge>
  }
  return (
    <Badge variant="outline" className={cn('border-destructive text-destructive', className)}>
      {t('concept_sets.standard.non_standard')}
    </Badge>
  )
}

interface ValidityBadgeProps {
  valid: boolean
  invalidReason?: string | null
  className?: string
}

export function ValidityBadge({ valid, invalidReason, className }: ValidityBadgeProps) {
  const { t } = useTranslation()
  if (valid) return <Badge className={cn('bg-green-600 text-white', className)}>{t('concept_sets.concept.valid')}</Badge>
  return (
    <Badge variant="outline" className={cn('border-destructive text-destructive', className)}>
      {invalidReason ? t('concept_sets.concept.invalid_reason', { reason: invalidReason }) : t('concept_sets.concept.invalid')}
    </Badge>
  )
}
