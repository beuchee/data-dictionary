import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link2, Loader2, Unlink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { useConfigStore } from '@/stores/config-store'
import { ConfirmDialog } from '@/features/drafts/confirm-dialog'
import { apiErrorCode, type IdentitySummary } from '@/features/users/users-api'
import { accountApi, isLastSignInMethod, linkableProviders, type AccountIdentities } from './account-api'

interface LinkedAccountsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * The sign-in identities of the account: link GitHub / GitLab / ORCID (the
 * OAuth start with the Bearer token, routes/oauth.py), or unlink one unless it
 * is the only way left to sign in.
 */
export function LinkedAccountsDialog({ open, onOpenChange }: LinkedAccountsDialogProps) {
  const { t } = useTranslation()
  const server = useConfigStore((s) => s.server)
  const enabled = server?.authProviders ?? []
  const [account, setAccount] = useState<AccountIdentities | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [linking, setLinking] = useState<string | null>(null)
  const [unlink, setUnlink] = useState<IdentitySummary | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    accountApi
      .identities()
      .then((a) => !cancelled && setAccount(a))
      .catch((e) => {
        console.error('Could not list the linked accounts', e)
        if (!cancelled) setError(t('account.linked.load_error'))
      })
    return () => {
      cancelled = true
    }
  }, [open, t])

  const link = async (provider: string) => {
    setLinking(provider)
    setError(null)
    try {
      window.location.assign(await accountApi.linkStart(provider))
    } catch (e) {
      console.error('Could not start linking', e)
      setError(t('account.linked.link_error'))
      setLinking(null)
    }
  }

  const doUnlink = async (identity: IdentitySummary) => {
    setError(null)
    try {
      setAccount(await accountApi.unlink(identity.id))
    } catch (e) {
      setError(apiErrorCode(e) === 'last_sign_in_method' ? t('account.linked.last_method') : t('account.linked.unlink_error'))
    }
  }

  const provider = (p: string) => t(`users.provider.${p}`, { defaultValue: p })

  return (
    <DialogShell open={open} onOpenChange={onOpenChange} kind="settings" title={t('account.linked.title')} description={t('account.linked.description')}>
      {error && <NoticeBanner tone="danger" title={error} />}
      {!account && !error && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
      {account && (
        <>
          <ul className="divide-y rounded-md border text-xs">
            <li className="flex items-center gap-2 px-3 py-2">
              <span className="flex-1 font-medium">{t('users.password')}</span>
              <Badge variant="outline">{account.hasPassword ? t('account.linked.set') : t('account.linked.not_set')}</Badge>
            </li>
            {account.identities.map((identity) => (
              <li key={identity.id} className="flex items-center gap-2 px-3 py-2">
                <span className="flex-1">
                  <span className="font-medium">{provider(identity.provider)}</span>
                  {(identity.username || identity.email) && <span className="text-muted-foreground"> · {identity.username ?? identity.email}</span>}
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={isLastSignInMethod(account)}
                  title={isLastSignInMethod(account) ? t('account.linked.last_method') : undefined}
                  onClick={() => setUnlink(identity)}
                >
                  <Unlink size={12} />
                  {t('account.linked.unlink')}
                </Button>
              </li>
            ))}
          </ul>
          {linkableProviders(enabled, account.identities).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {linkableProviders(enabled, account.identities).map((p) => (
                <Button key={p} variant="outline" size="sm" disabled={linking !== null} onClick={() => void link(p)}>
                  {linking === p ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
                  {t('account.linked.link', { provider: provider(p) })}
                </Button>
              ))}
            </div>
          )}
        </>
      )}
      <ConfirmDialog
        open={unlink !== null}
        onOpenChange={(o) => !o && setUnlink(null)}
        title={t('account.linked.unlink_title', { provider: unlink ? provider(unlink.provider) : '' })}
        description={t('account.linked.unlink_description')}
        confirmLabel={t('account.linked.unlink')}
        onConfirm={() => {
          if (unlink) void doUnlink(unlink)
          setUnlink(null)
        }}
      />
    </DialogShell>
  )
}
