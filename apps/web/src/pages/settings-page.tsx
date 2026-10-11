import { Suspense, lazy, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate, useParams } from 'react-router'
import { BookA, Palette, Ruler, Scale, Users, type LucideIcon } from 'lucide-react'
import { PageLoading } from '@/components/layout/page-loading'
import { PageContainer, PageHeader } from '@/components/ui/page-header'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { isServerMode } from '@/lib/api-client'
import { userHasPermission, useAuthStore } from '@/stores/auth-store'

interface SettingsTab {
  /** The URL segment: `/settings/<id>`. */
  id: string
  labelKey: string
  icon: LucideIcon
  component: ComponentType
  /** Shown only to users holding it (static mode: everyone, as userHasPermission). */
  permission?: string
  /** Only in server mode (accounts exist only there). */
  serverOnly?: boolean
}

const VocabulariesTab = lazy(() => import('@/features/vocabulary/vocabularies-tab').then((m) => ({ default: m.VocabulariesTab })))

const UnitConversionsTab = lazy(() => import('@/features/units/unit-conversions-tab').then((m) => ({ default: m.UnitConversionsTab })))
const RecommendedUnitsTab = lazy(() => import('@/features/units/recommended-units-tab').then((m) => ({ default: m.RecommendedUnitsTab })))
const BrandingTab = lazy(() => import('@/features/branding/branding-tab').then((m) => ({ default: m.BrandingTab })))
const UsersTab = lazy(() => import('@/features/users/users-tab').then((m) => ({ default: m.UsersTab })))

// One entry per settings tab, in display order; the first is the default.
const TABS: SettingsTab[] = [
  { id: 'vocabularies', labelKey: 'vocabulary.tab_title', icon: BookA, component: VocabulariesTab },
  { id: 'units', labelKey: 'units.tab_conversions', icon: Scale, component: UnitConversionsTab },
  { id: 'recommended-units', labelKey: 'units.tab_recommended', icon: Ruler, component: RecommendedUnitsTab },
  { id: 'branding', labelKey: 'branding.tab_title', icon: Palette, component: BrandingTab, permission: 'branding:write' },
  { id: 'users', labelKey: 'users.tab_title', icon: Users, component: UsersTab, permission: 'users:manage', serverOnly: true },
]

export function SettingsPage() {
  const { t } = useTranslation()
  const { tab } = useParams()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const tabs = TABS.filter(
    (x) => (!x.serverOnly || isServerMode()) && (!x.permission || userHasPermission(user, x.permission)),
  )
  const active = tabs.find((x) => x.id === tab)
  if (!active) return <Navigate to={`/settings/${tabs[0].id}`} replace />
  const Active = active.component

  return (
    <PageContainer width="5xl">
      <PageHeader title={t('settings.title')} description={t('settings.description')} />
      <Tabs value={active.id} onValueChange={(id) => navigate(`/settings/${id}`)} className="mb-4">
        <TabsList>
          {tabs.map(({ id, labelKey, icon: Icon }) => (
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
