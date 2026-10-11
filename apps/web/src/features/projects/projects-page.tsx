import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { CalendarDays, FolderKanban, Layers, Loader2, User } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { CardGrid } from '@/components/ui/card-grid'
import { EmptyState } from '@/components/ui/empty-state'
import { ListPageToolbar, type SortState } from '@/components/ui/list-page-toolbar'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { PageContainer, PageHeader } from '@/components/ui/page-header'
import { TruncatedText } from '@/components/ui/truncated-text'
import { useCatalogStore } from '@/stores/catalog-store'
import { formatContentDate } from './format'
import { projectCounts, projectTranslation } from './project-rows'
import type { Project } from '@/lib/data'

function matches(text: string | null | undefined, query: string): boolean {
  return !!text && text.toLowerCase().includes(query)
}

export function ProjectsPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const projects = useCatalogStore((s) => s.projects)
  const loadProjects = useCatalogStore((s) => s.loadProjects)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortState | null>(null)
  const lang = i18n.language

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  const all = useMemo(() => projects.data ?? [], [projects.data])
  const shown = useMemo(() => {
    const query = search.trim().toLowerCase()
    const rows = all.filter((p) => {
      if (!query) return true
      const tr = projectTranslation(p, lang)
      return matches(tr.name, query) || matches(tr.shortDescription, query)
    })
    if (!sort) return rows
    const key = (p: Project) =>
      sort.key === 'name' ? (projectTranslation(p, lang).name ?? '').toLowerCase() : (p.createdDate ?? '')
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => dir * key(a).localeCompare(key(b)) || a.id - b.id)
  }, [all, search, sort, lang])

  const loading = projects.status === 'idle' || (projects.status === 'loading' && !projects.data)

  return (
    <PageContainer width="wide">
      <PageHeader title={t('projects.title')} description={t('projects.description')} />

      {projects.status === 'error' && (
        <NoticeBanner tone="danger" title={t('projects.load_error')} description={projects.error} className="mt-4" />
      )}

      {all.length > 0 && (
        <ListPageToolbar
          searchQuery={search}
          onSearchChange={setSearch}
          searchPlaceholder={t('projects.search_placeholder')}
          sort={{
            options: [
              { key: 'name', label: t('projects.sort_name') },
              { key: 'created', label: t('projects.sort_created') },
            ],
            value: sort,
            onChange: setSort,
          }}
        />
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-muted-foreground" />
        </div>
      ) : all.length === 0 ? (
        projects.status === 'ready' && (
          <EmptyState
            icon={FolderKanban}
            title={t('projects.no_projects')}
            description={t('projects.no_projects_description')}
            className="mt-6"
          />
        )
      ) : shown.length === 0 ? (
        <EmptyState variant="filtered" title={t('projects.no_results')} />
      ) : (
        <CardGrid className="mt-4">
          {shown.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              lang={lang}
              onOpen={() => navigate(`/projects/${project.id}`)}
            />
          ))}
        </CardGrid>
      )}
    </PageContainer>
  )
}

interface ProjectCardProps {
  project: Project
  lang: string
  onOpen: () => void
}

function ProjectCard({ project, lang, onOpen }: ProjectCardProps) {
  const { t } = useTranslation()
  const tr = projectTranslation(project, lang)
  const counts = projectCounts(project)
  const created = formatContentDate(project.createdDate, lang)

  return (
    <Card
      role="link"
      tabIndex={0}
      className="flex min-h-44 cursor-pointer flex-col gap-0 py-0 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      <div className="flex flex-1 flex-col gap-2 px-4 pt-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <FolderKanban size={20} className="text-primary" />
          </div>
          {tr.name ? (
            <TruncatedText text={tr.name} readOnly className="min-w-0 flex-1 text-sm font-medium text-card-foreground" />
          ) : (
            <span className="min-w-0 flex-1 text-sm italic text-muted-foreground">{t('projects.untitled')}</span>
          )}
        </div>
        {tr.shortDescription && (
          <p className="line-clamp-3 text-xs text-muted-foreground">{tr.shortDescription}</p>
        )}
      </div>
      <div className="mt-auto px-4 pt-3 pb-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Layers size={12} />
            {t('projects.n_groups', { count: counts.groups })} · {t('projects.n_concept_sets', { count: counts.conceptSets })}
          </span>
          {project.createdBy && (
            <span className="flex min-w-0 items-center gap-1">
              <User size={12} className="shrink-0" />
              <span className="truncate">{project.createdBy}</span>
            </span>
          )}
          {created && (
            <span className="flex items-center gap-1">
              <CalendarDays size={12} />
              {created}
            </span>
          )}
        </div>
      </div>
    </Card>
  )
}
