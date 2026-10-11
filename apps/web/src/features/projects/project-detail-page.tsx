import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams, useSearchParams } from 'react-router'
import { ArrowLeft, FileText, FolderKanban, Loader2, Save, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { PageContainer, PageHeader } from '@/components/ui/page-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MarkdownEditor } from '@/components/editor/markdown-editor'
import { MarkdownRenderer } from '@/components/editor/markdown-renderer'
import { isServerMode } from '@/lib/api-client'
import { contentEqual } from '@/lib/drafts/diff'
import { findDraft, overlayConceptSetSummaries } from '@/lib/drafts/overlay'
import { isNewDraft } from '@/lib/drafts/paths'
import { cn } from '@/lib/utils'
import { useCatalogStore } from '@/stores/catalog-store'
import { useInstanceConfig } from '@/stores/config-store'
import { useDraftsStore } from '@/stores/drafts-store'
import { todayIso } from '@/features/drafts/identity'
import { useUnsavedChangesGuard } from '@/features/drafts/unsaved-changes'
import { GroupsEditor } from './editing/groups-editor'
import { UpdatePinsDialog, type PinUpdate } from './editing/update-pins-dialog'
import { useProjectsView } from './editing/use-projects-view'
import { editableGroups, updatePin, withGroups, withLongDescription } from './lib/project-editing'
import { ProjectActions } from './project-actions'
import { ProjectConceptSets } from './project-concept-sets'
import { projectTranslation } from './project-rows'
import type { PendingEdits } from '@/components/editor/code-editor'
import type { ConceptSetSummary, Project } from '@/lib/data'
import type { ProjectGroup } from '@data-dictionary/format'

const TABS = ['description', 'concept-sets'] as const
type Tab = (typeof TABS)[number]

interface EditSession {
  start: { project: Project; groups: ProjectGroup[] }
  project: Project
  groups: ProjectGroup[]
}

export function ProjectDetailPage() {
  const { t, i18n } = useTranslation()
  const config = useInstanceConfig()
  const { id: idParam } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const { resource: projects, view } = useProjectsView()
  const conceptSets = useCatalogStore((s) => s.conceptSets)
  const loadConceptSets = useCatalogStore((s) => s.loadConceptSets)
  const drafts = useDraftsStore((s) => s.drafts)
  const hiddenSets = useDraftsStore((s) => s.hidden['concept-set'])
  const saveDraft = useDraftsStore((s) => s.save)
  const lang = i18n.language
  const id = Number(idParam)
  const tabParam = searchParams.get('tab')
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : 'description'
  const [session, setSessionState] = useState<EditSession | null>(null)
  // Mirrors `session` synchronously, so Save reads the keystrokes an editor flush just committed.
  const sessionRef = useRef<EditSession | null>(null)
  const setSession = (next: EditSession | null | ((s: EditSession | null) => EditSession | null)) => {
    const value = typeof next === 'function' ? next(sessionRef.current) : next
    sessionRef.current = value
    setSessionState(value)
  }
  const [descLang, setDescLang] = useState(lang)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [updates, setUpdates] = useState<PinUpdate[] | null>(null)
  const pending = useRef<PendingEdits | null>(null)

  useEffect(() => {
    void loadConceptSets()
  }, [loadConceptSets])

  const project = useMemo(() => view.items.find((p) => p.id === id) ?? null, [view.items, id])
  const draft = findDraft(drafts, 'project', id)
  const overlaidSets = useMemo(() => overlayConceptSetSummaries(conceptSets.data ?? [], drafts, hiddenSets).items, [conceptSets.data, drafts, hiddenSets])
  const summaries = useMemo(() => new Map<number, ConceptSetSummary>(overlaidSets.map((cs) => [cs.id, cs])), [overlaidSets])
  const dirty = !!session && (!contentEqual(session.start.project, session.project) || !contentEqual(session.start.groups, session.groups))
  const { confirmIfDirty, dialog: unsavedDialog } = useUnsavedChangesGuard(dirty, () => setSession(null))

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

  const currentVersion = (csId: number) => summaries.get(csId)?.version ?? null
  const targetId = draft && isNewDraft(draft) ? null : project.id

  const startEditing = () => {
    const groups = editableGroups(project, currentVersion, config.languages)
    setSession({ start: { project, groups }, project, groups })
    setDescLang(config.languages.includes(lang) ? lang : config.defaultLanguage)
    setSaveError(null)
  }

  const save = () => {
    pending.current?.flush()
    const current = sessionRef.current
    if (current) void persist(withGroups(current.project, current.groups, todayIso()), true)
  }

  const persist = async (content: Project, endSession: boolean) => {
    setSaving(true)
    setSaveError(null)
    try {
      await saveDraft({ kind: 'project', targetId, content })
      if (endSession) setSession(null)
    } catch (e) {
      console.error('Could not save the project draft', e)
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const applyUpdates = async () => {
    if (!updates) return
    let groups = editableGroups(project, currentVersion, config.languages)
    for (const u of updates) groups = updatePin(groups, u.id, u.current)
    await persist(withGroups(project, groups, todayIso()), false)
    setUpdates(null)
  }

  const tr = projectTranslation(project, lang)
  const editing = session !== null

  return (
    <PageContainer width="wide">
      <PageHeader
        above={back}
        title={tr.name || <span className="italic text-muted-foreground">{t('projects.untitled')}</span>}
        description={tr.shortDescription || undefined}
        actions={
          editing ? (
            <>
              <Button variant="ghost" onClick={() => confirmIfDirty(() => setSession(null))} disabled={saving}>
                <X size={14} />
                {t('common.cancel')}
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {t('projects.edit.save')}
              </Button>
            </>
          ) : (
            <ProjectActions project={project} draft={draft} projects={view.items} lang={lang} onEdit={startEditing} />
          )
        }
      />
      {view.draftIds.has(project.id) && (
        <Badge variant="outline" className="mt-2 border-primary/50 text-primary">
          {isServerMode() ? t('drafts.badge_server') : t('drafts.badge')}
        </Badge>
      )}
      {saveError && <NoticeBanner tone="danger" title={t('drafts.save_failed')} description={saveError} className="mt-4" />}

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
          {session ? (
            <MarkdownEditor
              key={descLang}
              value={session.project.translations?.[descLang]?.longDescription ?? ''}
              onChange={(text) => setSession((s) => s && { ...s, project: withLongDescription(s.project, descLang, text) })}
              pendingEditsRef={pending}
              height="calc(100vh - 20rem)"
              toolbarExtra={
                config.languages.length > 1 &&
                config.languages.map((l) => (
                  <Button
                    key={l}
                    size="xs"
                    variant={l === descLang ? 'secondary' : 'ghost'}
                    aria-pressed={l === descLang}
                    className={cn(l === descLang && 'font-semibold')}
                    onClick={() => {
                      pending.current?.flush()
                      setDescLang(l)
                    }}
                  >
                    {l.toUpperCase()}
                  </Button>
                ))
              }
            />
          ) : tr.longDescription ? (
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
          ) : session ? (
            <GroupsEditor
              groups={session.groups}
              onChange={(groups) => setSession((s) => s && { ...s, groups })}
              summaries={overlaidSets}
              lang={lang}
              languages={config.languages}
            />
          ) : (
            <ProjectConceptSets
              project={project}
              summaries={summaries}
              lang={lang}
              onUpdate={(r) => r.currentVersion && setUpdates([{ id: r.id, name: r.name, pinned: r.pinnedVersion, current: r.currentVersion }])}
              onUpdateAll={(rows) =>
                setUpdates(rows.filter((r) => r.currentVersion).map((r) => ({ id: r.id, name: r.name, pinned: r.pinnedVersion, current: r.currentVersion as string })))
              }
            />
          )}
        </TabsContent>
      </Tabs>

      <UpdatePinsDialog
        open={updates !== null}
        onOpenChange={(o) => !o && setUpdates(null)}
        updates={updates ?? []}
        onConfirm={() => void applyUpdates()}
        busy={saving}
      />
      {unsavedDialog}
    </PageContainer>
  )
}
