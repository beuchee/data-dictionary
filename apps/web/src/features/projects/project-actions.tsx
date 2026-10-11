import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Download, GitPullRequest, MoreHorizontal, Pencil, Trash2, Undo2, UserPen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { isServerMode } from '@/lib/api-client'
import { forgeName, repositoryConfig } from '@/lib/data/forge'
import { findDraft } from '@/lib/drafts/overlay'
import { isNewDraft } from '@/lib/drafts/paths'
import { canEdit } from '@/lib/drafts/permissions'
import { userHasPermission, useAuthStore } from '@/stores/auth-store'
import { conceptSetKey, useCatalogStore } from '@/stores/catalog-store'
import { useInstanceConfig } from '@/stores/config-store'
import { useDraftsStore } from '@/stores/drafts-store'
import { ConfirmDialog } from '@/features/drafts/confirm-dialog'
import { todayIso } from '@/features/drafts/identity'
import { SubmitDialog } from '@/features/drafts/submit-dialog'
import { ExportProjectDialog } from '@/features/export'
import { ProjectDetailsDialog } from './editing/project-details-dialog'
import { applyProjectDetails } from './lib/project-editing'
import type { ConceptSet } from '@data-dictionary/format'
import type { Project } from '@/lib/data'
import type { DraftOf } from '@/lib/drafts/types'

interface ProjectActionsProps {
  /** The project as shown (its draft when it has one). */
  project: Project
  draft: DraftOf<'project'> | undefined
  /** Every project the user sees, for the name check. */
  projects: readonly Project[]
  lang: string
  onEdit: () => void
}

/**
 * The buttons on a project's title row: Submit / Propose and Discard for a
 * project with a draft, Edit, Export (CSV and JSON), name and description,
 * and Delete (static mode, hidden in this browser like v1).
 */
export function ProjectActions({ project, draft, projects, lang, onEdit }: ProjectActionsProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const config = useInstanceConfig()
  const user = useAuthStore((s) => s.user)
  const drafts = useDraftsStore((s) => s.drafts)
  const saveDraft = useDraftsStore((s) => s.save)
  const discardDraft = useDraftsStore((s) => s.discard)
  const hide = useDraftsStore((s) => s.hide)
  const loadConceptSet = useCatalogStore((s) => s.loadConceptSet)
  const [exportOpen, setExportOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [submitOpen, setSubmitOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const mayEdit = canEdit('project', (p) => userHasPermission(user, p))
  const isNew = !!draft && isNewDraft(draft)
  const forge = forgeName(repositoryConfig(config))

  // A pinned set at its version; the current version of a set with a draft is that draft.
  const pinned = async (id: number, version: string | undefined): Promise<ConceptSet | null> => {
    const csDraft = findDraft(drafts, 'concept-set', id)
    if (csDraft && (!version || csDraft.content.version === version)) return csDraft.content
    await loadConceptSet(id, version)
    return useCatalogStore.getState().conceptSetDetails[conceptSetKey(id, version)]?.data ?? null
  }

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    try {
      await action()
    } catch (e) {
      console.error('Project action failed', e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {draft && (
        <Button onClick={() => setSubmitOpen(true)}>
          <GitPullRequest size={14} />
          {isServerMode() ? t('drafts.submit_button') : t('drafts.propose_button', { forge })}
        </Button>
      )}
      {mayEdit && (
        <Button variant={draft ? 'outline' : 'default'} onClick={onEdit}>
          <Pencil size={14} />
          {t('projects.edit.edit')}
        </Button>
      )}
      <Button variant="outline" onClick={() => setExportOpen(true)}>
        <Download size={14} />
        {t('projects.edit.export')}
      </Button>
      {(mayEdit || draft) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon-sm" aria-label={t('projects.edit.more')}>
              <MoreHorizontal size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" density="compact">
            {mayEdit && (
              <DropdownMenuItem onClick={() => setDetailsOpen(true)}>
                <UserPen size={14} />
                {t('projects.edit.details')}
              </DropdownMenuItem>
            )}
            {draft && (
              <DropdownMenuItem onClick={() => setDiscardOpen(true)}>
                <Undo2 size={14} />
                {t('drafts.discard_button')}
              </DropdownMenuItem>
            )}
            {!isServerMode() && mayEdit && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
                  <Trash2 size={14} />
                  {t('projects.edit.delete')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {exportOpen && <ExportProjectDialog open={exportOpen} onOpenChange={setExportOpen} project={project} loadConceptSet={pinned} lang={lang} />}
      <ProjectDetailsDialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        project={project}
        projects={projects}
        busy={busy}
        onSubmit={(details) =>
          run(async () => {
            await saveDraft({ kind: 'project', targetId: isNew ? null : project.id, content: applyProjectDetails(project, details, todayIso()) })
            setDetailsOpen(false)
          })
        }
      />
      <SubmitDialog open={submitOpen} onOpenChange={setSubmitOpen} draft={draft ?? null} />
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={t('drafts.discard.title')}
        description={t('drafts.discard.description', { name: project.translations?.[lang]?.name || `#${project.id}` })}
        confirmLabel={t('drafts.discard.confirm')}
        onConfirm={() =>
          void run(async () => {
            setDiscardOpen(false)
            if (!draft) return
            await discardDraft(draft.id)
            if (isNew) navigate('/projects')
          })
        }
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('projects.edit.delete_title')}
        description={t(isNew ? 'projects.edit.delete_new_description' : 'projects.edit.delete_description')}
        confirmLabel={t('projects.edit.delete')}
        onConfirm={() =>
          void run(async () => {
            setDeleteOpen(false)
            if (draft) await discardDraft(draft.id)
            if (!isNew) hide('project', project.id)
            navigate('/projects')
          })
        }
      />
    </>
  )
}
