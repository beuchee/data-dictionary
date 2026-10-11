// "New user" (server mode, `users:manage`): a local account with a chosen or
// generated temporary password, which the user must change at first sign-in.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DialogShell } from '@/components/ui/dialog-shell'
import { CopyIconButton } from '@/components/ui/copy-icon-button'
import { FieldError } from '@/components/ui/field-error'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { NewPasswordFields, newPasswordReady } from '@/components/ui/new-password-fields'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SwitchRow } from '@/features/branding/branding-fields'
import { passwordErrorFromApi, type PasswordRuleError } from '@/lib/password-policy'
import { isValidUsername } from '@/lib/username-rule'
import { useAuthStore } from '@/stores/auth-store'
import { apiErrorCode, usersApi, type CreatedUser, type RolesInfo } from './users-api'

const KNOWN_ERRORS = ['username_taken', 'email_taken', 'username_invalid', 'admin_only', 'unknown_role']

interface CreateUserDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  roles: RolesInfo
  roleLabel: (name: string) => string
  onCreated: (user: CreatedUser) => void
}

export function CreateUserDialog({ open, onOpenChange, roles, roleLabel, onCreated }: CreateUserDialogProps) {
  const { t } = useTranslation()
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin')
  const [username, setUsername] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('viewer')
  const [generate, setGenerate] = useState(true)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [policyError, setPolicyError] = useState<PasswordRuleError | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<CreatedUser | null>(null)

  const name = username.trim()
  const usernameValid = isValidUsername(name)
  const passwordOk = generate || (newPasswordReady(password, confirm, { username: name }) && !policyError)
  const ready = usernameValid && !!role && passwordOk
  // Only an administrator may create an administrator (the server enforces it).
  const assignable = roles.roles.filter((r) => r.name !== 'admin' || isAdmin)

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setUsername('')
      setFirstName('')
      setLastName('')
      setEmail('')
      setRole('viewer')
      setGenerate(true)
      setPassword('')
      setConfirm('')
      setPolicyError(null)
      setError(null)
      setCreated(null)
    }
    onOpenChange(next)
  }

  const submit = async () => {
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      const user = await usersApi.create({
        username: name,
        email: email.trim() || null,
        firstName: firstName.trim() || null,
        lastName: lastName.trim() || null,
        role,
        ...(generate ? {} : { password }),
      })
      setCreated(user)
      onCreated(user)
    } catch (e) {
      const policy = passwordErrorFromApi(e)
      const code = apiErrorCode(e)
      if (policy) setPolicyError(policy)
      else if (code === 'username_invalid') setError(t('auth.username_rule.invalid'))
      else setError(code && KNOWN_ERRORS.includes(code) ? t(`users.error.${code}`) : t('users.error.generic'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={handleOpenChange}
      title={t('users.create.title')}
      description={t('users.create.description')}
      onConfirm={created ? undefined : () => void submit()}
      confirmLabel={t('users.create.submit')}
      confirmDisabled={!ready}
      busy={busy}
    >
      {created ? (
        created.temporaryPassword ? (
          <NoticeBanner
            tone="warning"
            title={t('users.create.done_generated', { name: created.username })}
            description={
              <span className="flex items-center gap-1">
                <code className="break-all rounded bg-muted px-1 py-0.5 font-mono text-xs">{created.temporaryPassword}</code>
                <CopyIconButton text={created.temporaryPassword} />
              </span>
            }
          />
        ) : (
          <NoticeBanner tone="progress" title={t('users.create.done', { name: created.username })} />
        )
      ) : (
        <>
          <FormField label={t('users.col.username')} required>
            {({ id }) => (
              <>
                <Input id={id} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" autoFocus maxLength={64} />
                <FieldError message={name && !usernameValid ? t('auth.username_rule.invalid') : null} />
              </>
            )}
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label={t('users.create.first_name')}>
              {({ id }) => <Input id={id} value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={255} />}
            </FormField>
            <FormField label={t('users.create.last_name')}>
              {({ id }) => <Input id={id} value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={255} />}
            </FormField>
          </div>
          <FormField label={t('users.col.email')}>
            {({ id }) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={255} />}
          </FormField>
          <FormField label={t('users.col.role')} required>
            {({ id }) => (
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id={id} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {assignable.map((r) => (
                    <SelectItem key={r.name} value={r.name}>
                      {roleLabel(r.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <SwitchRow
            label={t('users.create.generate')}
            hint={t('users.create.generate_hint')}
            checked={generate}
            onChange={(checked) => {
              setGenerate(checked)
              setPolicyError(null)
            }}
          />
          {!generate && (
            <NewPasswordFields
              password={password}
              confirm={confirm}
              onPasswordChange={(v) => {
                setPassword(v)
                setPolicyError(null)
              }}
              onConfirmChange={setConfirm}
              username={name}
              serverError={policyError}
              passwordLabel={t('users.temporary_password')}
              confirmLabel={t('users.temporary_password_confirm')}
              required
            />
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </>
      )}
    </DialogShell>
  )
}
