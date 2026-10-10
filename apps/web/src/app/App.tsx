import { Suspense, lazy, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, Route, Routes, useLocation } from 'react-router'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { Header } from '@/components/layout/header'
import { PageLoading } from '@/components/layout/page-loading'
import { resolveLanguage } from '@/lib/i18n'
import { useAppStore } from '@/stores/app-store'
import { useInstanceConfig } from '@/stores/config-store'

const lazyPage = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })))

const ConceptSetsPage = lazyPage(() => import('@/pages/concept-sets-page'), 'ConceptSetsPage')
const ProjectsPage = lazyPage(() => import('@/pages/projects-page'), 'ProjectsPage')
const MappingPage = lazyPage(() => import('@/pages/mapping-page'), 'MappingPage')
const SettingsPage = lazyPage(() => import('@/pages/settings-page'), 'SettingsPage')
const DevToolsPage = lazyPage(() => import('@/pages/dev-tools-page'), 'DevToolsPage')
const DocumentationPage = lazyPage(() => import('@/pages/documentation-page'), 'DocumentationPage')

export function App() {
  const { i18n } = useTranslation()
  const config = useInstanceConfig()
  const darkMode = useAppStore((s) => s.darkMode)
  const storedLanguage = useAppStore((s) => s.language)
  const location = useLocation()
  const language = resolveLanguage(storedLanguage, config.languages, config.defaultLanguage)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
  }, [darkMode])

  useEffect(() => {
    i18n.changeLanguage(language)
    document.documentElement.lang = language
  }, [language, i18n])

  const showProjects = config.tabs?.showProjects !== false
  const showMapping = config.tabs?.showMappingRecommendations !== false

  return (
    <SidebarProvider className="!min-h-0 h-screen">
      <AppSidebar />
      <SidebarInset className="flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-hidden">
          {/* Keyed on the path so a navigation shows the fallback instead of
              keeping the previous page on screen during the router transition. */}
          <Suspense key={location.pathname} fallback={<PageLoading />}>
            <Routes>
              <Route path="/" element={<Navigate to="/concept-sets" replace />} />
              <Route path="/concept-sets" element={<ConceptSetsPage />} />
              {showProjects && <Route path="/projects" element={<ProjectsPage />} />}
              {showMapping && <Route path="/mapping" element={<MappingPage />} />}
              <Route path="/settings/:tab?" element={<SettingsPage />} />
              <Route path="/dev-tools" element={<DevToolsPage />} />
              <Route path="/documentation" element={<DocumentationPage />} />
              <Route path="*" element={<Navigate to="/concept-sets" replace />} />
            </Routes>
          </Suspense>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
