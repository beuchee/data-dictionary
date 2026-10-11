import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitPullRequest, Loader2, Pencil, Save, Undo2, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { MarkdownEditor } from '@/components/editor/markdown-editor'
import { isServerMode } from '@/lib/api-client'
import { forgeName, repositoryConfig } from '@/lib/data/forge'
import { contentEqual } from '@/lib/drafts/diff'
import { canEdit } from '@/lib/drafts/permissions'
import { cn } from '@/lib/utils'
import { userHasPermission, useAuthStore } from '@/stores/auth-store'
import { useInstanceConfig } from '@/stores/config-store'
import { useDraftsStore } from '@/stores/drafts-store'
import { ConfirmDialog } from '@/features/drafts/confirm-dialog'
import { SubmitDialog } from '@/features/drafts/submit-dialog'
import { useUnsavedChangesGuard } from '@/features/drafts/unsaved-changes'
import type { MappingRecommendations } from '@data-dictionary/format'
import type { PendingEdits } from '@/components/editor/code-editor'
import type { DraftOf } from '@/lib/drafts/types'

interface RecommendationsToolbarProps {
  draft: DraftOf<'mapping-recommendations'> | undefined
  onEdit: () => void
}

/** Edit / Submit / Discard above the recommendations (read mode). */
export function RecommendationsToolbar({ draft, onEdit }: RecommendationsToolbarProps) {
  const { t } = useTranslation()
  const config = useInstanceConfig()
  const user = useAuthStore((s) => s.user)
  const discard = useDraftsStore((s) => s.discard)
  const [submitOpen, setSubmitOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const mayEdit = canEdit('mapping-recommendations', (p) => userHasPermission(user, p))
  if (!mayEdit && !draft) return null

  return (
    <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
      {draft && (
        <Badge variant="outline" className="mr-auto border-primary/50 text-primary">
          {isServerMode() ? t('drafts.badge_server') : t('drafts.badge')}
        </Badge>
      )}
      {draft && (
        <>
          <Button variant="outline" onClick={() => setDiscardOpen(true)}>
            <Undo2 size={14} />
            {t('drafts.discard_button')}
          </Button>
          <Button onClick={() => setSubmitOpen(true)}>
            <GitPullRequest size={14} />
            {isServerMode() ? t('drafts.submit_button') : t('drafts.propose_button', { forge: forgeName(repositoryConfig(config)) })}
          </Button>
        </>
      )}
      {mayEdit && (
        <Button variant={draft ? 'outline' : 'default'} onClick={onEdit}>
          <Pencil size={14} />
          {t('mapping.edit')}
        </Button>
      )}
      <SubmitDialog open={submitOpen} onOpenChange={setSubmitOpen} draft={draft ?? null} />
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={t('drafts.discard.title')}
        description={t('drafts.discard.description', { name: t('drafts.kind.mapping-recommendations') })}
        confirmLabel={t('drafts.discard.confirm')}
        onConfirm={() => {
          setDiscardOpen(false)
          if (draft) discard(draft.id).catch((e) => console.error('Could not discard the draft', e))
        }}
      />
    </div>
  )
}

interface RecommendationsEditorProps {
  initial: MappingRecommendations
  initialLang: string
  onClose: () => void
}

/** The recommendations of each language in Markdown, saved as a `mapping-recommendations` draft. */
export function RecommendationsEditor({ initial, initialLang, onClose }: RecommendationsEditorProps) {
  const { t } = useTranslation()
  const config = useInstanceConfig()
  const saveDraft = useDraftsStore((s) => s.save)
  const [working, setWorkingState] = useState(initial)
  // Mirrors `working` synchronously, so Save reads what an editor flush just committed.
  const workingRef = useRef(initial)
  const [lang, setLang] = useState(config.languages.includes(initialLang) ? initialLang : config.defaultLanguage)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef<PendingEdits | null>(null)
  const dirty = !contentEqual(initial, working)
  const { confirmIfDirty, dialog } = useUnsavedChangesGuard(dirty, onClose)

  const setText = (text: string) => {
    const translations = { ...(workingRef.current.translations ?? {}) }
    translations[lang] = { ...(translations[lang] ?? {}), content: text.replace(/\s+$/, '') || null }
    workingRef.current = { ...workingRef.current, translations }
    setWorkingState(workingRef.current)
  }

  const save = async () => {
    pending.current?.flush()
    setSaving(true)
    setError(null)
    try {
      if (!contentEqual(initial, workingRef.current)) {
        await saveDraft({ kind: 'mapping-recommendations', targetId: null, content: workingRef.current })
      }
      onClose()
    } catch (e) {
      console.error('Could not save the mapping recommendations', e)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => confirmIfDirty(onClose)} disabled={saving}>
          <X size={14} />
          {t('common.cancel')}
        </Button>
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {t('mapping.save')}
        </Button>
      </div>
      {error && <NoticeBanner tone="danger" title={t('drafts.save_failed')} description={error} />}
      <MarkdownEditor
        key={lang}
        value={working.translations?.[lang]?.content ?? ''}
        onChange={setText}
        pendingEditsRef={pending}
        height="calc(100vh - 18rem)"
        toolbarExtra={
          config.languages.length > 1 &&
          config.languages.map((l) => (
            <Button
              key={l}
              size="xs"
              variant={l === lang ? 'secondary' : 'ghost'}
              aria-pressed={l === lang}
              className={cn(l === lang && 'font-semibold')}
              onClick={() => {
                pending.current?.flush()
                setLang(l)
              }}
            >
              {l.toUpperCase()}
            </Button>
          ))
        }
      />
      {dialog}
    </div>
  )
}
