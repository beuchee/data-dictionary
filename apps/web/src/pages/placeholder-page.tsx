import { useTranslation } from 'react-i18next'
import type { LucideIcon } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { PageContainer, PageHeader } from '@/components/ui/page-header'

interface PlaceholderPageProps {
  /** Key under `pages.` holding `title`, `description` and `empty`. */
  pageKey: string
  icon: LucideIcon
}

// TODO(v2-phase-1): replace each placeholder with its real page.
export function PlaceholderPage({ pageKey, icon }: PlaceholderPageProps) {
  const { t } = useTranslation()
  return (
    <PageContainer>
      <PageHeader title={t(`pages.${pageKey}.title`)} description={t(`pages.${pageKey}.description`)} />
      <EmptyState icon={icon} title={t('common.coming_soon')} description={t(`pages.${pageKey}.empty`)} className="mt-8" />
    </PageContainer>
  )
}
