import { useTranslation } from 'react-i18next'
import { AlertTriangle, Check } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { GroupRule } from '@/lib/coverage'
import type { ReviewStatus } from '@data-dictionary/format'
import type { VersionStatus } from './project-rows'

// Status colours carry meaning (the v1 palette), so they are not theme tokens.
const REVIEW_STATUS_CLASS: Record<ReviewStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  pending_review: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  approved: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  needs_revision: 'bg-orange-500/15 text-orange-700 dark:text-orange-400',
  deprecated: 'bg-destructive/10 text-destructive',
}

export function ReviewStatusBadge({ status }: { status: ReviewStatus | null }) {
  const { t } = useTranslation()
  if (!status || !(status in REVIEW_STATUS_CLASS)) return null
  return <Badge className={REVIEW_STATUS_CLASS[status]}>{t(`projects.review_status.${status}`)}</Badge>
}

const RULE_CLASS: Record<GroupRule, string> = {
  all_required: 'border-primary/40 text-primary',
  at_least_one: 'border-sky-500/40 text-sky-700 dark:text-sky-400',
  optional: 'border-border text-muted-foreground',
}

export function RuleBadge({ rule }: { rule: GroupRule }) {
  const { t } = useTranslation()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" tabIndex={0} className={cn('cursor-default', RULE_CLASS[rule])}>
          {t(`projects.rule.${rule}`)}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{t(`projects.rule_hint.${rule}`)}</TooltipContent>
    </Tooltip>
  )
}

interface VersionStatusBadgeProps {
  status: VersionStatus
  pinned: string
  current: string | null
}

export function VersionStatusBadge({ status, pinned, current }: VersionStatusBadgeProps) {
  const { t } = useTranslation()
  if (status === 'no_version') {
    return <span className="text-muted-foreground">{t('projects.version_status.no_version')}</span>
  }
  if (status === 'up_to_date') {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
        <Check />
        {t('projects.version_status.up_to_date')}
      </Badge>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge tabIndex={0} className="cursor-default bg-amber-500/15 text-amber-700 dark:text-amber-400">
          <AlertTriangle />
          {t('projects.version_status.outdated')}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{t('projects.outdated_hint', { pinned, current })}</TooltipContent>
    </Tooltip>
  )
}
