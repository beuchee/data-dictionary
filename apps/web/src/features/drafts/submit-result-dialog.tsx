import { useTranslation } from 'react-i18next'
import { CheckCircle2, ExternalLink } from 'lucide-react'
import { CopyIconButton } from '@/components/ui/copy-icon-button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { useSubmitResultStore } from '@/stores/submit-result-store'

/** Mounted once, in the app shell. */
export function SubmitResultDialog() {
  const { t } = useTranslation()
  const result = useSubmitResultStore((s) => s.result)
  const close = useSubmitResultStore((s) => s.close)

  return (
    <DialogShell open={!!result} onOpenChange={(open) => !open && close()} title={t('drafts.submit.done_title')}>
      {result && (
        <div className="flex items-start gap-2 text-sm">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-primary" />
          <div className="min-w-0 space-y-2">
            <p>{t(result.mode === 'commit' ? 'drafts.submit.done_commit' : 'drafts.submit.done_proposal')}</p>
            {result.proposalUrl && (
              <a href={result.proposalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all text-primary hover:underline">
                {result.proposalUrl}
                <ExternalLink size={12} aria-hidden />
              </a>
            )}
            {result.commitSha && (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                {t('drafts.submit.commit_sha')} <code className="font-mono">{result.commitSha.slice(0, 12)}</code>
                <CopyIconButton text={result.commitSha} />
              </p>
            )}
            {result.conceptSetId != null && <p className="text-xs text-muted-foreground">{t('drafts.submit.allocated_id', { id: result.conceptSetId })}</p>}
            {result.resolved === 'updated' && <p className="text-xs text-muted-foreground">{t('expression.submit_resolved_updated')}</p>}
            {result.resolved === 'stale' && <NoticeBanner tone="warning" title={t('expression.submit_resolved_stale')} />}
            {result.proposalError && <NoticeBanner tone="warning" title={t('expression.submit_proposal_error')} description={result.proposalError} />}
          </div>
        </div>
      )}
    </DialogShell>
  )
}
