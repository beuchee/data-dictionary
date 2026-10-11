import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams, useSearchParams } from 'react-router'
import { ArrowLeft, FileText, FolderKanban, Loader2 } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { PageContainer, PageHeader } from '@/components/ui/page-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer'
import { useCatalogStore } from '@/stores/catalog-store'
import { ProjectActions } from './project-actions'
import { ProjectConceptSets } from './project-concept-sets'
import { projectTranslation } from './project-rows'
import type { ConceptSetSummary } from '@/lib/data'

const TABS = ['description', 'concept-sets'] as const
type Tab = (typeof TABS)[number]

export function ProjectDetailPage() {
  const { t, i18n } = useTranslation()
  const { id: idParam } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const projects = useCatalogStore((s) => s.projects)
  const conceptSets = useCatalogStore((s) => s.conceptSets)
  const loadProjects = useCatalogStore((s) => s.loadProjects)
  const loadConceptSets = useCatalogStore((s) => s.loadConceptSets)
  const lang = i18n.language
  const id = Number(idParam)
  const tabParam = searchParams.get('tab')
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : 'description'

  useEffect(() => {
    loadProjects()
    loadConceptSets()
  }, [loadProjects, loadConceptSets])

  const project = useMemo(() => projects.data?.find((p) => p.id === id) ?? null, [projects.data, id])
  const summaries = useMemo(
    () => new Map<number, ConceptSetSummary>((conceptSets.data ?? []).map((cs) => [cs.id, cs])),
    [conceptSets.data],
  )

  const back = (
    <Link to="/projects" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
      <ArrowLeft size={12} />
      {t('projects.back')}
    </Link>
  )

  if (!project) {
    const pending = projects.status === 'idle' || projects.status === 'loading'
    return (
      <PageContainer width="wide">
        {pending ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin text-muted-foreground" />
          </div>
        ) : projects.status === 'error' ? (
          <>
            <PageHeader title={t('projects.title')} above={back} />
            <NoticeBanner tone="danger" title={t('projects.load_error')} description={projects.error} className="mt-4" />
          </>
        ) : (
          <>
            <PageHeader title={t('projects.title')} above={back} />
            <EmptyState
              icon={FolderKanban}
              title={t('projects.not_found')}
              description={t('projects.not_found_description', { id: idParam })}
              className="mt-6"
            />
          </>
        )}
      </PageContainer>
    )
  }

  const tr = projectTranslation(project, lang)

  return (
    <PageContainer width="wide">
      <PageHeader
        above={back}
        title={tr.name || <span className="italic text-muted-foreground">{t('projects.untitled')}</span>}
        description={tr.shortDescription || undefined}
        actions={<ProjectActions project={project} />}
      />

      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = new URLSearchParams(searchParams)
          if (value === 'description') next.delete('tab')
          else next.set('tab', value)
          setSearchParams(next, { replace: true })
        }}
        className="mt-6"
      >
        <TabsList>
          <TabsTrigger value="description">{t('projects.tab_description')}</TabsTrigger>
          <TabsTrigger value="concept-sets">{t('projects.tab_concept_sets')}</TabsTrigger>
        </TabsList>

        <TabsContent value="description" className="mt-4">
          {tr.longDescription ? (
            <MarkdownRenderer content={tr.longDescription} />
          ) : (
            <EmptyState icon={FileText} title={t('projects.no_description')} className="mt-4" />
          )}
        </TabsContent>

        <TabsContent value="concept-sets" className="mt-4">
          {conceptSets.status === 'error' ? (
            <NoticeBanner tone="danger" title={t('projects.concept_sets_load_error')} description={conceptSets.error} />
          ) : conceptSets.status !== 'ready' ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ProjectConceptSets project={project} summaries={summaries} lang={lang} />
          )}
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}
