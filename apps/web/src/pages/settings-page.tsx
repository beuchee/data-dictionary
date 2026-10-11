import { Suspense, lazy, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate, useParams } from 'react-router'
import { BookA, type LucideIcon } from 'lucide-react'
import { PageLoading } from '@/components/layout/page-loading'
import { PageContainer, PageHeader } from '@/components/ui/page-header'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

interface SettingsTab {
  /** The URL segment: `/settings/<id>`. */
  id: string
  labelKey: string
  icon: LucideIcon
  component: ComponentType
}

const VocabulariesTab = lazy(() => import('@/features/vocabulary/vocabularies-tab').then((m) => ({ default: m.VocabulariesTab })))

// One entry per settings tab, in display order; the first is the default.
// TODO(v2-phase-4): units and unit conversions.
const TABS: SettingsTab[] = [
  { id: 'vocabularies', labelKey: 'vocabulary.tab_title', icon: BookA, component: VocabulariesTab },
]

export function SettingsPage() {
  const { t } = useTranslation()
  const { tab } = useParams()
  const navigate = useNavigate()
  const active = TABS.find((x) => x.id === tab)
  if (!active) return <Navigate to={`/settings/${TABS[0].id}`} replace />
  const Active = active.component

  return (
    <PageContainer width="5xl">
      <PageHeader title={t('settings.title')} description={t('settings.description')} />
      <Tabs value={active.id} onValueChange={(id) => navigate(`/settings/${id}`)} className="mb-4">
        <TabsList>
          {TABS.map(({ id, labelKey, icon: Icon }) => (
            <TabsTrigger key={id} value={id}>
              <Icon size={14} />
              {t(labelKey)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Suspense fallback={<PageLoading />}>
        <Active />
      </Suspense>
    </PageContainer>
  )
}
