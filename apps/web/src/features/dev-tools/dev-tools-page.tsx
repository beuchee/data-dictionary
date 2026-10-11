import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { PageContainer, PageHeader } from '@/components/ui/page-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ErdTab } from './erd-tab'
import { SqlTab } from './sql-tab'

const SECTIONS = ['sql', 'erd'] as const
type Section = (typeof SECTIONS)[number]

/** `/dev-tools?section=sql|erd`: v1's SQL editor and vocabulary schema. */
export function DevToolsPage() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const param = searchParams.get('section')
  const section: Section = SECTIONS.includes(param as Section) ? (param as Section) : 'sql'

  return (
    <PageContainer width="wide">
      <PageHeader title={t('dev_tools.title')} description={t('dev_tools.description')} />
      <Tabs
        value={section}
        onValueChange={(value) => {
          const next = new URLSearchParams(searchParams)
          if (value === 'sql') next.delete('section')
          else next.set('section', value)
          setSearchParams(next, { replace: true })
        }}
        className="mt-6"
      >
        <TabsList>
          <TabsTrigger value="sql">{t('dev_tools.tab_sql')}</TabsTrigger>
          <TabsTrigger value="erd">{t('dev_tools.tab_erd')}</TabsTrigger>
        </TabsList>
        <TabsContent value="sql" className="mt-4">
          <SqlTab />
        </TabsContent>
        <TabsContent value="erd" className="mt-4">
          <ErdTab />
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}
