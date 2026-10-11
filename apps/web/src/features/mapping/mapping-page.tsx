import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { PageContainer, PageHeader } from '@/components/ui/page-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CoverageTab } from './coverage-tab'
import { RecommendationsTab } from './recommendations-tab'

const TABS = ['recommendations', 'coverage'] as const
type Tab = (typeof TABS)[number]

export function MappingPage() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : 'recommendations'

  return (
    <PageContainer width="5xl">
      <PageHeader title={t('mapping.title')} description={t('mapping.description')} />
      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = new URLSearchParams(searchParams)
          if (value === 'recommendations') next.delete('tab')
          else next.set('tab', value)
          setSearchParams(next, { replace: true })
        }}
        className="mt-6"
      >
        <TabsList>
          <TabsTrigger value="recommendations">{t('mapping.tab_recommendations')}</TabsTrigger>
          <TabsTrigger value="coverage">{t('mapping.tab_coverage')}</TabsTrigger>
        </TabsList>
        <TabsContent value="recommendations" className="mt-4">
          <RecommendationsTab />
        </TabsContent>
        <TabsContent value="coverage" className="mt-4">
          <CoverageTab />
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}
