import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { FormField } from '@/components/ui/form-field'
import { NewPasswordFields, newPasswordReady } from '@/components/ui/new-password-fields'
import { PasswordInput } from '@/components/ui/password-input'
import { ApiError } from '@/lib/api-client'
import { passwordErrorFromApi, type PasswordRuleError } from '@/lib/password-policy'
import { useAuthStore } from '@/stores/auth-store'

interface ChangePasswordDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * The password was set by an administrator: the dialog cannot be dismissed,
   * only completed or left by logging out.
   */
  required?: boolean
}

export function ChangePasswordDialog({ open, onOpenChange, required }: ChangePasswordDialogProps) {
  const { t } = useTranslation()
  const username = useAuthStore((s) => s.user?.username ?? '')
  const changePassword = useAuthStore((s) => s.changePassword)
  const logout = useAuthStore((s) => s.logout)
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [policyError, setPolicyError] = useState<PasswordRuleError | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const ready = !!current && newPasswordReady(password, confirm, { username, current }) && !policyError

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setCurrent('')
      setPassword('')
      setConfirm('')
      setPolicyError(null)
      setError(null)
    }
    onOpenChange(next)
  }

  const handleConfirm = async () => {
    if (!ready) return
    setSaving(true)
    setError(null)
    try {
      await changePassword(current, password)
      handleOpenChange(false)
    } catch (e) {
      const policy = passwordErrorFromApi(e)
      if (policy) setPolicyError(policy)
      else if (e instanceof ApiError && e.status === 403) setError(t('auth.password.wrong_current'))
      else if (e instanceof ApiError && e.status === 400) setError(t('auth.password.no_local_password'))
      else setError(t('auth.password.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <DialogShell
      open={open}
      // Esc and outside clicks close nothing while a new password is required.
      onOpenChange={required ? () => undefined : handleOpenChange}
      title={t(required ? 'auth.password.required_title' : 'auth.password.title')}
      description={t(required ? 'auth.password.required_description' : 'auth.password.description')}
      hideClose={required}
      hideCancel={required}
      footerExtra={
        required ? (
          <Button variant="ghost" size="sm" onClick={logout} disabled={saving}>
            {t('auth.menu.logout')}
          </Button>
        ) : undefined
      }
      onConfirm={handleConfirm}
      confirmLabel={t('auth.password.submit')}
      confirmDisabled={!ready}
      busy={saving}
    >
      <FormField label={t('auth.password.current')} required>
        {({ id }) => (
          <PasswordInput
            id={id}
            value={current}
            autoComplete="current-password"
            onChange={(e) => {
              setCurrent(e.target.value)
              setError(null)
            }}
          />
        )}
      </FormField>
      <NewPasswordFields
        password={password}
        confirm={confirm}
        onPasswordChange={(v) => {
          setPassword(v)
          setPolicyError(null)
        }}
        onConfirmChange={setConfirm}
        username={username}
        current={current}
        serverError={policyError}
        passwordLabel={t('auth.password.new')}
        confirmLabel={t('auth.password.confirm')}
        required
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </DialogShell>
  )
}
