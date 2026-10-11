import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Code, GitPullRequest, Loader2, MoreHorizontal, Pencil, Save, Tag, Trash2, Undo2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { isServerMode } from '@/lib/api-client'
import { forgeName, repositoryConfig } from '@/lib/data/forge'
import { isNewDraft } from '@/lib/drafts/paths'
import { canEdit } from '@/lib/drafts/permissions'
import { stampConceptSetEdit } from '@/lib/export/provenance'
import { userHasPermission, useAuthStore } from '@/stores/auth-store'
import { useInstanceConfig } from '@/stores/config-store'
import { useDraftsStore } from '@/stores/drafts-store'
import { ConfirmDialog } from '@/features/drafts/confirm-dialog'
import { useEditStamp } from '@/features/drafts/identity'
import { SubmitDialog } from '@/features/drafts/submit-dialog'
import { REVIEW_STATUSES, type ConceptSet, type ExpressionItem, type ReviewStatus } from '@data-dictionary/format'
import { applyMetadata, applyVersionBump } from '../lib/editing'
import { listPath } from '../lib/navigation'
import { useConceptSetEditor, useEditorDirty } from './editor-store'
import { ExportButton } from './export-button'
import { MetadataDialog } from './metadata-dialog'
import { VersionDialog } from './version-dialog'
import type { ConceptSetSummary } from '@/lib/data'
import type { DraftOf } from '@/lib/drafts/types'

interface ConceptSetActionsProps {
  /** The set as shown: the working copy, else the user's draft, else the repository's. */
  shown: ConceptSet
  /** The repository's current version; null for a set that only exists as a draft. */
  base: ConceptSet | null
  draft: DraftOf<'concept-set'> | undefined
  /** A past version is shown: read-only. */
  pastVersion: boolean
  requestedVersion: string | undefined
  lang: string
  /** Versions already published (never reused by a bump). */
  published: readonly string[]
  summaries: readonly ConceptSetSummary[]
  /** The expression to resolve live (edited or drafted, unlike the repository's), for the SQL export. */
  liveItems?: readonly ExpressionItem[] | null
  onViewJson: () => void
  /** Runs `action` unless edits would be lost, after asking. */
  confirmIfDirty: (action: () => void) => void
}

/**
 * The detail page's header actions. Reading: Export, JSON, Edit, and for a set
 * with a draft Submit (Propose in static mode) and Discard. Editing: metadata,
 * status, new version, Cancel and Save (to the draft).
 */
export function ConceptSetActions({
  shown,
  base,
  draft,
  pastVersion,
  requestedVersion,
  lang,
  published,
  summaries,
  liveItems,
  onViewJson,
  confirmIfDirty,
}: ConceptSetActionsProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const config = useInstanceConfig()
  const user = useAuthStore((s) => s.user)
  const editing = useConceptSetEditor((s) => s.id === shown.id && s.working !== null)
  const working = useConceptSetEditor((s) => s.working)
  const isNew = useConceptSetEditor((s) => s.isNew)
  const errors = useConceptSetEditor((s) => s.errors)
  const start = useConceptSetEditor((s) => s.start)
  const update = useConceptSetEditor((s) => s.update)
  const stop = useConceptSetEditor((s) => s.stop)
  const flush = useConceptSetEditor((s) => s.flush)
  const dirty = useEditorDirty()
  const saveDraft = useDraftsStore((s) => s.save)
  const discardDraft = useDraftsStore((s) => s.discard)
  const hide = useDraftsStore((s) => s.hide)
  const stamp = useEditStamp()

  const [metadataOpen, setMetadataOpen] = useState(false)
  const [versionOpen, setVersionOpen] = useState(false)
  const [submitOpen, setSubmitOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const forge = forgeName(repositoryConfig(config))
  const mayEdit = canEdit('concept-set', (p) => userHasPermission(user, p))
  const hasErrors = Object.keys(errors).length > 0

  const save = async () => {
    const current = flush()
    if (!current || hasErrors) return
    if (!dirty && !useConceptSetEditor.getState().isNew) {
      stop()
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      await saveDraft({ kind: 'concept-set', targetId: isNew ? null : current.id, content: stampConceptSetEdit(current, stamp()) })
      stop()
    } catch (e) {
      console.error('Could not save the concept set draft', e)
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const deleteSet = async () => {
    setDeleteOpen(false)
    try {
      if (draft) await discardDraft(draft.id)
      // A set created here only existed as its draft; a repository set is hidden in this browser, as v1.
      if (!draft || !isNewDraft(draft)) hide('concept-set', shown.id)
      stop()
      navigate(listPath())
    } catch (e) {
      console.error('Could not delete the concept set', e)
      setSaveError(e instanceof Error ? e.message : String(e))
    }
  }

  const discard = async () => {
    setDiscardOpen(false)
    if (!draft) return
    try {
      await discardDraft(draft.id)
      if (isNewDraft(draft)) navigate(listPath())
    } catch (e) {
      console.error('Could not discard the draft', e)
      setSaveError(e instanceof Error ? e.message : String(e))
    }
  }

  if (editing && working) {
    return (
      <>
        <Button variant="outline" onClick={() => setMetadataOpen(true)}>
          <Pencil size={14} />
          {t('concept_sets.edit.metadata')}
        </Button>
        <Select
          value={working.metadata?.reviewStatus ?? 'draft'}
          onValueChange={(status) => update((cs) => ({ ...cs, metadata: { ...cs.metadata, reviewStatus: status as ReviewStatus } }))}
        >
          <SelectTrigger size="sm" className="min-w-36" aria-label={t('concept_sets.columns.status')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REVIEW_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`concept_sets.status.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => setVersionOpen(true)}>
          <Tag size={14} />
          {t('concept_sets.edit.version_button', { version: working.version })}
        </Button>
        <Button variant="ghost" onClick={() => confirmIfDirty(stop)} disabled={saving}>
          <X size={14} />
          {t('common.cancel')}
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button onClick={() => void save()} disabled={saving || hasErrors}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {t('concept_sets.edit.save')}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{saveError ? t('drafts.save_failed') + ': ' + saveError : t('concept_sets.edit.save_hint')}</TooltipContent>
        </Tooltip>

        <MetadataDialog
          open={metadataOpen}
          onOpenChange={setMetadataOpen}
          conceptSet={working}
          summaries={summaries}
          onSubmit={(values) => {
            update((cs) => applyMetadata(cs, values))
            setMetadataOpen(false)
          }}
        />
        <VersionDialog
          open={versionOpen}
          onOpenChange={setVersionOpen}
          working={working}
          base={base}
          published={published}
          onApply={(bump) => {
            update((cs) => applyVersionBump(cs, base?.version ?? null, bump))
            setVersionOpen(false)
          }}
        />
      </>
    )
  }

  return (
    <>
      {draft && !pastVersion && (
        <Button onClick={() => setSubmitOpen(true)}>
          <GitPullRequest size={14} />
          {isServerMode() ? t('drafts.submit_button') : t('drafts.propose_button', { forge })}
        </Button>
      )}
      {mayEdit && !pastVersion && (
        <Button variant={draft ? 'outline' : 'default'} onClick={() => start(draft?.content ?? shown, { isNew: !!draft && isNewDraft(draft) })}>
          <Pencil size={14} />
          {t('concept_sets.edit.edit')}
        </Button>
      )}
      <ExportButton conceptSet={shown} version={pastVersion ? requestedVersion : undefined} lang={lang} liveItems={liveItems} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon-sm" aria-label={t('concept_sets.edit.more')}>
            <MoreHorizontal size={14} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" density="compact">
          <DropdownMenuItem onClick={onViewJson}>
            <Code size={14} />
            {t('concept_sets.detail.view_json')}
          </DropdownMenuItem>
          {draft && !pastVersion && (
            <DropdownMenuItem onClick={() => setDiscardOpen(true)}>
              <Undo2 size={14} />
              {t('drafts.discard_button')}
            </DropdownMenuItem>
          )}
          {/* Deleting a file through a proposal is not supported by the server: static mode only (v1 hid it locally). */}
          {!isServerMode() && !pastVersion && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
                <Trash2 size={14} />
                {t('concept_sets.edit.delete')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <SubmitDialog open={submitOpen} onOpenChange={setSubmitOpen} draft={draft ?? null} base={base} />
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={t('drafts.discard.title')}
        description={t('drafts.discard.description', { name: shown.metadata?.translations?.[lang]?.name || `#${shown.id}` })}
        confirmLabel={t('drafts.discard.confirm')}
        onConfirm={() => void discard()}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('concept_sets.edit.delete_title')}
        description={t(draft && isNewDraft(draft) ? 'concept_sets.edit.delete_new_description' : 'concept_sets.edit.delete_description')}
        confirmLabel={t('concept_sets.edit.delete')}
        onConfirm={() => void deleteSet()}
      />
    </>
  )
}
