import { useTranslation } from 'react-i18next'
import type { LucideIcon } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { PageContainer, PageHeader } from '@/components/ui/page-header'

interface PlaceholderPageProps {
  /** Top-level i18n key (a locale namespace) holding `title`, `description` and `empty`. */
  pageKey: string
  icon: LucideIcon
}

// TODO(v2-phase-1): replace each placeholder with its real page.
export function PlaceholderPage({ pageKey, icon }: PlaceholderPageProps) {
  const { t } = useTranslation()
  return (
    <PageContainer>
      <PageHeader title={t(`${pageKey}.title`)} description={t(`${pageKey}.description`)} />
      <EmptyState icon={icon} title={t('common.coming_soon')} description={t(`${pageKey}.empty`)} className="mt-8" />
    </PageContainer>
  )
}
