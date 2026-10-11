// Look adapted from linkr@1310cf4a4 apps/web/src/components/versioning/GitSyncPanel.tsx
// (the behind / diverged banner, the pull action); the dictionary has one content
// repository and pulls by fast-forward only, so no file list nor 3-way merge.
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDownToLine, CheckCircle2, GitBranch, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyIconButton } from '@/components/ui/copy-icon-button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { submitErrorFrom, type SubmitError } from '@/lib/drafts/submit-errors'
import { useCatalogStore } from '@/stores/catalog-store'
import { getApiDraftStore } from '@/stores/drafts-store'
import type { GitStatus, PullResult } from '@/lib/drafts/api-draft-store'

interface RepositoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b py-1.5 text-xs last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-1 font-medium">{children}</span>
    </div>
  )
}

function Sha({ sha }: { sha: string | null }) {
  if (!sha) return <span className="text-muted-foreground">—</span>
  return (
    <>
      <code className="font-mono">{sha.slice(0, 12)}</code>
      <CopyIconButton text={sha} />
    </>
  )
}

/**
 * Maintainers: the content repository the server writes to (branch, HEAD,
 * remote head, ahead / behind after a fetch, dirty) and a Pull that
 * fast-forwards it and indexes the versions merged since (`POST /git/pull`).
 */
export function RepositoryDialog({ open, onOpenChange }: RepositoryDialogProps) {
  const { t } = useTranslation()
  const resetCatalog = useCatalogStore((s) => s.reset)
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [error, setError] = useState<SubmitError | null>(null)
  const [pulled, setPulled] = useState<PullResult | null>(null)

  const refresh = useCallback(async (fetch: boolean) => {
    setLoading(true)
    setError(null)
    try {
      setStatus(await (await getApiDraftStore()).fetchGitStatus(fetch))
    } catch (e) {
      setError(submitErrorFrom(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setPulled(null)
    void refresh(true)
  }, [open, refresh])

  const pull = async () => {
    setPulling(true)
    setError(null)
    try {
      const result = await (await getApiDraftStore()).pull()
      setPulled(result)
      if (result.updated || result.indexCommitSha) resetCatalog()
      await refresh(false)
    } catch (e) {
      setError(submitErrorFrom(e))
    } finally {
      setPulling(false)
    }
  }

  const behind = status?.behind ?? 0
  const diverged = !!status && (status.ahead ?? 0) > 0 && behind > 0

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      kind="settings"
      title={t('repository.title')}
      description={status?.remote ?? undefined}
      hideFooter
    >
      {loading && !status && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          {t('repository.loading')}
        </p>
      )}

      {status && behind > 0 && (
        <NoticeBanner
          tone="warning"
          title={t(diverged ? 'repository.diverged' : 'repository.behind', { count: behind })}
          action={
            !diverged ? (
              <Button size="xs" variant="outline" onClick={() => void pull()} disabled={pulling}>
                {pulling ? <Loader2 size={12} className="animate-spin" /> : <ArrowDownToLine size={12} />}
                {t('repository.pull')}
              </Button>
            ) : undefined
          }
        />
      )}
      {status?.dirty && <NoticeBanner tone="warning" title={t('repository.dirty')} />}
      {status && behind === 0 && status.behind !== null && !status.dirty && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <CheckCircle2 size={14} className="text-primary" />
          {t('repository.up_to_date')}
        </p>
      )}

      {status && (
        <div>
          <Row label={t('repository.branch')}>
            <GitBranch size={12} />
            {status.branch ?? '—'}
            {status.contentBranch && status.branch !== status.contentBranch && (
              <span className="text-destructive">({t('repository.expected', { branch: status.contentBranch })})</span>
            )}
          </Row>
          <Row label={t('repository.head')}>
            <Sha sha={status.head} />
          </Row>
          <Row label={t('repository.remote_head')}>
            <Sha sha={status.remoteHead} />
          </Row>
          <Row label={t('repository.ahead_behind')}>
            {status.ahead === null || status.behind === null ? t('repository.not_fetched') : `${status.ahead} / ${status.behind}`}
          </Row>
        </div>
      )}

      {pulled && (
        <p className="flex items-center gap-2 text-xs">
          <CheckCircle2 size={14} className="shrink-0 text-primary" />
          {pulled.updated ? t('repository.pulled', { count: pulled.indexed.length }) : t('repository.nothing_pulled')}
        </p>
      )}
      {pulled?.indexError && <NoticeBanner tone="warning" title={t('repository.index_error')} description={pulled.indexError.message} />}
      {error && (
        <NoticeBanner
          tone="danger"
          title={t(`drafts.submit.error.${error.code}`)}
          description={error.message ?? undefined}
        />
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => void refresh(true)} disabled={loading || pulling}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {t('repository.fetch')}
        </Button>
        <Button onClick={() => void pull()} disabled={pulling || loading || !status}>
          {pulling ? <Loader2 size={14} className="animate-spin" /> : <ArrowDownToLine size={14} />}
          {t('repository.pull')}
        </Button>
      </div>
    </DialogShell>
  )
}
