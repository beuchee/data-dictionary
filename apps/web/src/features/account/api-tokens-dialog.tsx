// Personal API tokens (`/auth/api-tokens`), after linkr@1310cf4a4
// apps/web/src/features/settings/ApiTokensTab.tsx.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyRound, Loader2, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CopyIconButton } from '@/components/ui/copy-icon-button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { EmptyState } from '@/components/ui/empty-state'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ConfirmDialog } from '@/features/drafts/confirm-dialog'
import { accountApi, tokenState, type ApiToken, type CreatedApiToken } from './account-api'

interface ApiTokensDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const EXPIRIES = ['30', '90', '365', 'never'] as const

export function ApiTokensDialog({ open, onOpenChange }: ApiTokensDialogProps) {
  const { t, i18n } = useTranslation()
  const [tokens, setTokens] = useState<ApiToken[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [expiry, setExpiry] = useState<(typeof EXPIRIES)[number]>('90')
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<CreatedApiToken | null>(null)
  const [revoke, setRevoke] = useState<ApiToken | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    accountApi
      .listTokens()
      .then((list) => !cancelled && setTokens(list))
      .catch((e) => {
        console.error('Could not list the API tokens', e)
        if (!cancelled) setError(t('account.tokens.load_error'))
      })
    return () => {
      cancelled = true
    }
  }, [open, t])

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setCreated(null)
      setName('')
      setError(null)
    }
    onOpenChange(next)
  }

  const create = async () => {
    if (!name.trim()) return
    setCreating(true)
    setError(null)
    try {
      const token = await accountApi.createToken(name.trim(), expiry === 'never' ? null : Number(expiry))
      setCreated(token)
      setTokens((list) => [token, ...(list ?? [])])
      setName('')
    } catch (e) {
      console.error('Could not create the API token', e)
      setError(t('account.tokens.create_error'))
    } finally {
      setCreating(false)
    }
  }

  const doRevoke = async (token: ApiToken) => {
    try {
      const revoked = await accountApi.revokeToken(token.id)
      setTokens((list) => list?.map((x) => (x.id === revoked.id ? revoked : x)) ?? null)
    } catch (e) {
      console.error('Could not revoke the API token', e)
      setError(t('account.tokens.revoke_error'))
    }
  }

  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(i18n.language) : '—')

  return (
    <DialogShell open={open} onOpenChange={handleOpenChange} kind="settings" title={t('account.tokens.title')} description={t('account.tokens.description')}>
      {created && (
        <NoticeBanner
          tone="warning"
          title={t('account.tokens.created_title')}
          description={
            <span className="flex items-center gap-1">
              <code className="break-all rounded bg-muted px-1 py-0.5 font-mono text-xs">{created.token}</code>
              <CopyIconButton text={created.token} />
            </span>
          }
        />
      )}
      <div className="grid grid-cols-[1fr_8rem_auto] items-end gap-2">
        <FormField label={t('account.tokens.name')}>
          {({ id }) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('account.tokens.name_placeholder')} maxLength={255} />}
        </FormField>
        <FormField label={t('account.tokens.expiry')}>
          {({ id }) => (
            <Select value={expiry} onValueChange={(v) => setExpiry(v as (typeof EXPIRIES)[number])}>
              <SelectTrigger id={id}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRIES.map((e) => (
                  <SelectItem key={e} value={e}>
                    {t(`account.tokens.expiry_${e}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
        <Button onClick={() => void create()} disabled={!name.trim() || creating}>
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          {t('account.tokens.create')}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {tokens === null && !error && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
      {tokens?.length === 0 && <EmptyState icon={KeyRound} title={t('account.tokens.empty')} />}
      {tokens && tokens.length > 0 && (
        <ul className="divide-y rounded-md border">
          {tokens.map((token) => {
            const state = tokenState(token)
            return (
              <li key={token.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{token.name}</span>
                    <code className="font-mono text-muted-foreground">ddt_{token.prefix}…</code>
                    {state !== 'active' && <Badge variant="outline">{t(`account.tokens.state_${state}`)}</Badge>}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {t('account.tokens.dates', { created: date(token.createdAt), used: date(token.lastUsedAt), expires: token.expiresAt ? date(token.expiresAt) : t('account.tokens.expiry_never') })}
                  </div>
                </div>
                {state === 'active' && (
                  <Button variant="ghost" size="icon-xs" aria-label={t('account.tokens.revoke')} onClick={() => setRevoke(token)}>
                    <Trash2 size={12} />
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <ConfirmDialog
        open={revoke !== null}
        onOpenChange={(o) => !o && setRevoke(null)}
        title={t('account.tokens.revoke_title', { name: revoke?.name ?? '' })}
        description={t('account.tokens.revoke_description')}
        confirmLabel={t('account.tokens.revoke')}
        onConfirm={() => {
          if (revoke) void doRevoke(revoke)
          setRevoke(null)
        }}
      />
    </DialogShell>
  )
}
