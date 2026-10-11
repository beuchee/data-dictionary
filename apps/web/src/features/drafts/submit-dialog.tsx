import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitCommitHorizontal, GitPullRequest, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { FormField } from '@/components/ui/form-field'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { Textarea } from '@/components/ui/textarea'
import { isServerMode } from '@/lib/api-client'
import { copyText } from '@/lib/clipboard'
import { forgeName, repositoryConfig, repositoryUrl } from '@/lib/data/forge'
import { isReviewsOnlyChange } from '@/lib/drafts/diff'
import { forgeFileUrl, proposeSteps } from '@/lib/drafts/forge-propose'
import { draftEntityId, draftFilePath, isNewDraft } from '@/lib/drafts/paths'
import { PULL_PERMISSION, allowedSubmitModes } from '@/lib/drafts/permissions'
import { submitErrorFrom, type SubmitError } from '@/lib/drafts/submit-errors'
import { cn } from '@/lib/utils'
import { userHasPermission, useAuthStore } from '@/stores/auth-store'
import { useCatalogStore } from '@/stores/catalog-store'
import { useConfigStore, useInstanceConfig } from '@/stores/config-store'
import { getApiDraftStore, useDraftsStore } from '@/stores/drafts-store'
import { useSubmitResultStore } from '@/stores/submit-result-store'
import { ResolvedFileNotice } from '@/features/concept-sets/expression/resolved-file-notice'
import { defaultToolTag } from '@/features/export/export-settings'
import { defaultSubmitMessage } from './draft-content'
import { proposalText } from './proposal-text'
import { todayIso, useEditorIdentity } from './identity'
import type { ConceptSet } from '@data-dictionary/format'
import type { Draft, SubmitMode, SubmitResult } from '@/lib/drafts/types'

export interface SubmitDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  draft: Draft | null
  /** The repository's current version of a concept set, to recognise a reviews-only draft. */
  base?: ConceptSet | null
  /** A first line explaining what is being submitted (e.g. a review that rides inside the set's file). */
  intro?: string
  onSubmitted?: (result: SubmitResult) => void
}

/**
 * Submits a draft. Server mode: a commit message and a mode (a PR / MR, or a
 * direct commit for maintainers), then the link or SHA. Static mode: v1's
 * "Propose on GitHub / GitLab" hand-off (copy the file, open the forge).
 */
export function SubmitDialog(props: SubmitDialogProps) {
  return isServerMode() ? <ServerSubmitDialog {...props} /> : <ProposeDialog {...props} />
}

/** Renders `**bold**` spans of a translated string (React escapes the rest). */
export function BoldText({ text }: { text: string }) {
  return (
    <>
      {text.split(/\*\*([^*]+)\*\*/g).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part))}
    </>
  )
}

// --- Server mode -----------------------------------------------------------

function ServerSubmitDialog({ open, onOpenChange, draft, base, intro, onSubmitted }: SubmitDialogProps) {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.user)
  const forget = useDraftsStore((s) => s.forget)
  const resetCatalog = useCatalogStore((s) => s.reset)
  const reviewsOnly = !!draft && draft.kind === 'concept-set' && !!base && isReviewsOnlyChange(base, draft.content)
  const has = (p: string) => userHasPermission(user, p)
  const modes = draft ? allowedSubmitModes(draft.kind, has, reviewsOnly) : []

  const [message, setMessage] = useState('')
  const [mode, setMode] = useState<SubmitMode>('proposal')
  const [busy, setBusy] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [error, setError] = useState<SubmitError | null>(null)
  const showResult = useSubmitResultStore((s) => s.show)

  // Reset when the dialog opens on a draft, not on every permission re-render.
  const openedOn = open && draft ? draft.id : null
  const [lastOpened, setLastOpened] = useState<string | null>(null)
  if (openedOn !== lastOpened) {
    setLastOpened(openedOn)
    if (draft && openedOn) {
      setMessage(defaultSubmitMessage(draft, { reviewsOnly }))
      setMode(modes[0] ?? 'proposal')
      setError(null)
    }
  }

  const submit = async () => {
    if (!draft || !message.trim() || !modes.includes(mode)) return
    setBusy(true)
    setError(null)
    try {
      const store = await getApiDraftStore()
      const done = await store.submit(draft.id, mode, message.trim())
      onOpenChange(false)
      // The answer names the set's id for every concept-set submit; it is news only for a new set.
      showResult(isNewDraft(draft) ? done : { ...done, conceptSetId: undefined })
      forget(draft.id)
      // A commit changed the content (and a new set got its real id): read it again.
      if (done.mode === 'commit') resetCatalog()
      onSubmitted?.(done)
    } catch (e) {
      setError(submitErrorFrom(e))
    } finally {
      setBusy(false)
    }
  }

  const pull = async () => {
    setPulling(true)
    try {
      await (await getApiDraftStore()).pull()
      resetCatalog()
      setError(null)
    } catch (e) {
      setError(submitErrorFrom(e))
    } finally {
      setPulling(false)
    }
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      kind="settings"
      title={t('drafts.submit.title')}
      description={draft ? draftFilePath(draft.kind, draftEntityId(draft)) : undefined}
      onConfirm={submit}
      confirmLabel={mode === 'commit' ? t('drafts.submit.confirm_commit') : t('drafts.submit.confirm_proposal')}
      confirmDisabled={!message.trim() || modes.length === 0}
      busy={busy}
    >
      {intro && (
        <p className="text-xs text-muted-foreground">
          <BoldText text={intro} />
        </p>
      )}
      {modes.length === 0 && <NoticeBanner tone="warning" title={t('drafts.submit.no_permission')} />}
      {modes.length > 0 && (
        <div className="grid gap-2" role="radiogroup" aria-label={t('drafts.submit.mode')}>
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                'flex items-start gap-2 rounded-md border p-3 text-left transition-colors',
                mode === m ? 'border-primary bg-primary/5' : 'hover:bg-accent',
              )}
            >
              {m === 'commit' ? <GitCommitHorizontal size={16} className="mt-0.5 shrink-0" /> : <GitPullRequest size={16} className="mt-0.5 shrink-0" />}
              <span className="space-y-0.5">
                <span className="block text-sm font-medium">{t(`drafts.submit.mode_${m}`)}</span>
                <span className="block text-xs text-muted-foreground">{t(`drafts.submit.mode_${m}_hint`)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      <FormField label={t('drafts.submit.message')}>
        {({ id }) => <Textarea id={id} value={message} onChange={(e) => setMessage(e.target.value)} rows={3} />}
      </FormField>
      {error && <SubmitErrorBanner error={error} canPull={has(PULL_PERMISSION)} pulling={pulling} onPull={pull} />}
    </DialogShell>
  )
}

interface SubmitErrorBannerProps {
  error: SubmitError
  canPull: boolean
  pulling: boolean
  onPull: () => void
}

function SubmitErrorBanner({ error, canPull, pulling, onPull }: SubmitErrorBannerProps) {
  const { t } = useTranslation()
  const description = (
    <>
      {error.message && <span className="block">{error.message}</span>}
      {error.issues.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-4 font-mono text-[10px]">
          {error.issues.slice(0, 20).map((issue, i) => (
            <li key={i}>{issue}</li>
          ))}
        </ul>
      )}
    </>
  )
  return (
    <NoticeBanner
      tone={error.code === 'pull_required' ? 'warning' : 'danger'}
      title={t(`drafts.submit.error.${error.code}`)}
      description={error.message || error.issues.length ? description : undefined}
      action={
        error.code === 'pull_required' && canPull ? (
          <Button variant="outline" size="xs" onClick={onPull} disabled={pulling}>
            {pulling ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {t('drafts.submit.pull')}
          </Button>
        ) : undefined
      }
    />
  )
}

// --- Static mode -------------------------------------------------------------

function ProposeDialog({ open, onOpenChange, draft, base, intro }: SubmitDialogProps) {
  const { t } = useTranslation()
  const config = useInstanceConfig()
  const server = useConfigStore((s) => s.server)
  const { name } = useEditorIdentity()
  const repo = repositoryConfig(config)
  const forge = forgeName(repo)
  const [manualCopy, setManualCopy] = useState(false)
  const [blocked, setBlocked] = useState(false)

  const prepared = (() => {
    if (!draft || !open) return null
    const text = proposalText(draft, {
      toolTag: defaultToolTag(server?.appVersion),
      date: todayIso(),
      modifiedBy: name,
      repoUrl: repositoryUrl(repo),
    })
    const path = draftFilePath(draft.kind, draftEntityId(draft))
    const isNew = isNewDraft(draft)
    const target = forgeFileUrl(repo, path, { isNew, content: text })
    return { text, path, isNew, target, steps: proposeSteps({ isNew, prefilled: target.prefilled }) }
  })()

  // Reset when the dialog opens.
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setManualCopy(false)
      setBlocked(false)
    }
  }

  const openForge = () => {
    if (!prepared) return
    // Not the 'noopener' feature: with it window.open returns null, which reads as blocked.
    const opened = window.open(prepared.target.url, '_blank')
    if (opened) opened.opener = null
    setBlocked(!opened)
    if (opened) onOpenChange(false)
  }

  // Copy BEFORE opening the tab: once the forge has focus, the clipboard API
  // rejects. On failure the forge stays closed and the JSON is shown instead.
  const confirm = async () => {
    if (!prepared) return
    if (prepared.target.prefilled) return openForge()
    if (await copyText(prepared.text)) openForge()
    else setManualCopy(true)
  }

  if (!prepared) return null

  if (manualCopy) {
    return (
      <DialogShell
        open={open}
        onOpenChange={onOpenChange}
        kind="workbench"
        title={t('drafts.propose.manual_title')}
        description={t('drafts.propose.manual_description', { path: prepared.path })}
        onConfirm={openForge}
        confirmLabel={t('drafts.propose.manual_open', { forge })}
        noEnterSubmit
      >
        <Textarea readOnly value={prepared.text} className="h-full min-h-[50vh] font-mono text-xs" onFocus={(e) => e.currentTarget.select()} autoFocus />
      </DialogShell>
    )
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      kind="settings"
      title={t(prepared.isNew ? 'drafts.propose.title_create' : 'drafts.propose.title_update', { forge })}
      description={<code className="font-mono">{prepared.path}</code>}
      onConfirm={() => void confirm()}
      confirmLabel={t('drafts.propose.open', { forge })}
    >
      <ol className="list-decimal space-y-1.5 pl-5 text-sm">
        {intro && (
          <li>
            <BoldText text={intro} />
          </li>
        )}
        {prepared.steps.map((step) => (
          <li key={step}>
            <BoldText text={t(`drafts.propose.${step}`, { forge })} />
          </li>
        ))}
      </ol>
      {draft?.kind === 'concept-set' && <ResolvedFileNotice content={draft.content} base={base ?? null} isNew={prepared.isNew} />}
      {blocked && <NoticeBanner tone="warning" title={t('drafts.propose.popup_blocked')} />}
    </DialogShell>
  )
}
