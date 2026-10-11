import { useTranslation } from 'react-i18next'
import { Upload } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'

/**
 * Coverage of an imported mapping against the projects.
 *
 * TODO(v2-phase-4): the multi-format mapping importer (docs/planning/v2-plan.md §7)
 * feeds this tab; the evaluation itself is ready in `@/lib/coverage`
 * (`evaluateAllProjects`, with resolved ids loaded at each project's pinned versions).
 */
export function CoverageTab() {
  const { t } = useTranslation()
  return (
    <EmptyState
      icon={Upload}
      title={t('mapping.coverage_title')}
      description={
        <span className="flex max-w-xl flex-col gap-2 text-center">
          <span>{t('mapping.coverage_description')}</span>
          <span className="italic">{t('mapping.coverage_coming')}</span>
        </span>
      }
      className="mt-4"
    />
  )
}
