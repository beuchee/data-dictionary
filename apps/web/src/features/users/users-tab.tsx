// Users and roles administration (server mode, `users:manage`). Shaped after
// linkr@1310cf4a4 apps/web/src/features/settings/UsersTab.tsx, rewritten for the
// dictionary's single global role per user.
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyRound, Loader2, MoreHorizontal, UserCheck, UserX } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTable, type DataTableColumn } from '@/components/ui/data-table'
import { DialogShell } from '@/components/ui/dialog-shell'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { NewPasswordFields, newPasswordReady } from '@/components/ui/new-password-fields'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { SectionLabel } from '@/components/ui/section-label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ApiError } from '@/lib/api-client'
import { passwordErrorFromApi, type PasswordRuleError } from '@/lib/password-policy'
import { useAuthStore } from '@/stores/auth-store'
import { ConfirmDialog } from '@/features/drafts/confirm-dialog'
import { apiErrorCode, fullName, usersApi, type AdminUser, type RolesInfo } from './users-api'

const KNOWN_ERRORS = ['last_admin', 'self_deactivation', 'admin_only', 'unknown_role']

export function UsersTab() {
  const { t, i18n } = useTranslation()
  const me = useAuthStore((s) => s.user)
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [roles, setRoles] = useState<RolesInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [deactivate, setDeactivate] = useState<AdminUser | null>(null)
  const [resetFor, setResetFor] = useState<AdminUser | null>(null)

  const load = useCallback(async () => {
    try {
      const [u, r] = await Promise.all([usersApi.list(), usersApi.roles()])
      setUsers(u)
      setRoles(r)
      setLoadError(null)
    } catch (e) {
      console.error('Could not load the users', e)
      setLoadError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    // Loading on mount; the state is set once the requests answer.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const describeError = (e: unknown) => {
    const code = apiErrorCode(e)
    return code && KNOWN_ERRORS.includes(code) ? t(`users.error.${code}`) : t('users.error.generic')
  }

  const update = async (user: AdminUser, patch: { role?: string; isActive?: boolean }) => {
    setBusyId(user.id)
    setActionError(null)
    try {
      const updated = await usersApi.update(user.id, patch)
      setUsers((list) => list?.map((u) => (u.id === updated.id ? updated : u)) ?? null)
    } catch (e) {
      setActionError(describeError(e))
    } finally {
      setBusyId(null)
    }
  }

  const roleLabel = (name: string) => {
    const role = roles?.roles.find((r) => r.name === name)
    return role?.label[i18n.language] ?? role?.label.en ?? name
  }
  const dateText = (iso: string | null) => (iso ? new Date(iso).toLocaleString(i18n.language) : t('users.never'))

  const columns: DataTableColumn<AdminUser>[] = [
    { id: 'username', header: t('users.col.username'), accessor: (u) => u.username, filter: 'text', size: 140 },
    { id: 'name', header: t('users.col.name'), accessor: (u) => fullName(u) ?? '', filter: 'text', size: 160 },
    { id: 'email', header: t('users.col.email'), accessor: (u) => u.email ?? '', filter: 'text', size: 180 },
    {
      id: 'role',
      header: t('users.col.role'),
      accessor: (u) => u.role,
      display: (u) => roleLabel(u.role),
      filter: 'select',
      selectOptionLabel: roleLabel,
      cell: (u) => (
        <Select value={u.role} onValueChange={(role) => void update(u, { role })} disabled={busyId === u.id}>
          <SelectTrigger className="h-7 w-36 text-xs" aria-label={t('users.col.role')} onClick={(e) => e.stopPropagation()}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {roles?.roles.map((r) => (
              <SelectItem key={r.name} value={r.name}>
                {roleLabel(r.name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
      size: 160,
    },
    {
      id: 'identities',
      header: t('users.col.identities'),
      accessor: (u) => [u.hasPassword ? 'local' : '', ...u.identities.map((i) => i.provider)].filter(Boolean).join(' '),
      cell: (u) => (
        <div className="flex flex-wrap gap-1">
          {u.hasPassword && <Badge variant="outline">{t('users.password')}</Badge>}
          {u.identities.map((i) => (
            <Badge key={i.id} variant="secondary" title={i.username ?? i.email ?? undefined}>
              {t(`users.provider.${i.provider}`, { defaultValue: i.provider })}
              {i.username ? ` · ${i.username}` : ''}
            </Badge>
          ))}
        </div>
      ),
      size: 200,
    },
    {
      id: 'active',
      header: t('users.col.status'),
      accessor: (u) => (u.isActive ? t('users.active') : t('users.inactive')),
      filter: 'select',
      cell: (u) => (u.isActive ? <Badge variant="outline">{t('users.active')}</Badge> : <Badge variant="destructive">{t('users.inactive')}</Badge>),
      size: 100,
    },
    { id: 'lastLogin', header: t('users.col.last_login'), accessor: (u) => u.lastLogin ?? '', display: (u) => dateText(u.lastLogin), size: 150 },
    {
      id: 'actions',
      header: t('users.col.actions'),
      headerCell: () => null,
      accessor: () => null,
      cell: (u) =>
        busyId === u.id ? (
          <Loader2 size={14} className="animate-spin text-muted-foreground" />
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label={t('users.col.actions')}>
                <MoreHorizontal size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" density="compact">
              <DropdownMenuItem onClick={() => setResetFor(u)}>
                <KeyRound size={14} />
                {t('users.reset_password')}
              </DropdownMenuItem>
              {u.isActive ? (
                <DropdownMenuItem onClick={() => setDeactivate(u)} disabled={u.id === me?.id}>
                  <UserX size={14} />
                  {t('users.deactivate')}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => void update(u, { isActive: true })}>
                  <UserCheck size={14} />
                  {t('users.reactivate')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      size: 60,
    },
  ]

  if (loadError) return <NoticeBanner tone="danger" title={t('users.load_error')} description={loadError} />
  if (!users || !roles) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">{t('users.description')}</p>
        {actionError && <NoticeBanner tone="danger" title={actionError} onDismiss={() => setActionError(null)} />}
        <DataTable data={users} columns={columns} rowKey={(u) => u.id} pageSize={50} emptyMessage={t('users.empty')} />
      </div>
      <RolesMatrix roles={roles} roleLabel={roleLabel} />
      <ConfirmDialog
        open={deactivate !== null}
        onOpenChange={(open) => !open && setDeactivate(null)}
        title={t('users.deactivate_title', { name: deactivate?.username ?? '' })}
        description={t('users.deactivate_description')}
        confirmLabel={t('users.deactivate')}
        onConfirm={() => {
          if (deactivate) void update(deactivate, { isActive: false })
          setDeactivate(null)
        }}
      />
      <ResetPasswordDialog user={resetFor} onClose={() => setResetFor(null)} />
    </div>
  )
}

interface RolesMatrixProps {
  roles: RolesInfo
  roleLabel: (name: string) => string
}

/** The five seeded roles and what each may do (read-only). */
function RolesMatrix({ roles, roleLabel }: RolesMatrixProps) {
  const { t } = useTranslation()
  const permissions = Object.entries(roles.catalogue).flatMap(([resource, actions]) => actions.map((a) => `${resource}:${a}`))
  return (
    <div className="space-y-2">
      <SectionLabel as="h3">{t('users.roles_title')}</SectionLabel>
      <p className="text-xs text-muted-foreground">{t('users.roles_description')}</p>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="px-2 py-1.5 text-left font-medium">{t('users.permission')}</th>
              {roles.roles.map((r) => (
                <th key={r.name} className="px-2 py-1.5 text-center font-medium">
                  {roleLabel(r.name)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {permissions.map((p) => (
              <tr key={p} className="border-b last:border-0">
                <td className="px-2 py-1 font-mono">{p}</td>
                {roles.roles.map((r) => (
                  <td key={r.name} className="px-2 py-1 text-center">
                    {r.permissions.includes(p) ? <span aria-label={t('users.granted')}>✓</span> : <span className="text-muted-foreground">·</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

interface ResetPasswordDialogProps {
  user: AdminUser | null
  onClose: () => void
}

function ResetPasswordDialog({ user, onClose }: ResetPasswordDialogProps) {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [serverError, setServerError] = useState<PasswordRuleError | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [lastUser, setLastUser] = useState<AdminUser | null>(null)
  if (user !== lastUser) {
    setLastUser(user)
    setPassword('')
    setConfirm('')
    setServerError(null)
    setError(null)
    setDone(false)
  }
  if (!user) return null
  const ready = newPasswordReady(password, confirm, { username: user.username }) && !serverError

  const submit = async () => {
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      await usersApi.resetPassword(user.id, password)
      setDone(true)
    } catch (e) {
      let policy: PasswordRuleError | null = null
      if (e instanceof ApiError && e.status === 422) {
        try {
          policy = passwordErrorFromApi(JSON.parse(e.message))
        } catch {
          policy = null
        }
      }
      if (policy) setServerError(policy)
      else setError(t('users.error.generic'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogShell
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('users.reset_title', { name: user.username })}
      description={t('users.reset_description')}
      onConfirm={done ? undefined : () => void submit()}
      confirmLabel={t('users.reset_confirm')}
      confirmDisabled={!ready}
      busy={busy}
    >
      {done ? (
        <NoticeBanner tone="progress" title={t('users.reset_done', { name: user.username })} />
      ) : (
        <>
          <NewPasswordFields
            password={password}
            confirm={confirm}
            onPasswordChange={(v) => {
              setPassword(v)
              setServerError(null)
            }}
            onConfirmChange={setConfirm}
            username={user.username}
            serverError={serverError}
            passwordLabel={t('users.temporary_password')}
            confirmLabel={t('users.temporary_password_confirm')}
            required
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </>
      )}
    </DialogShell>
  )
}
