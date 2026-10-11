// Adapted from linkr@1310cf4a4 apps/web/src/features/setup/SetupWizard.tsx: the admin account,
// then (signed in) the instance steps of instance-setup.tsx.
// TODO(v2-phase-5): choosing the content repository itself (URL, branch, token) from the
// wizard; today it is environment configuration, shown read-only (v2-plan § 3).
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FieldError } from '@/components/ui/field-error'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { NewPasswordFields, newPasswordReady } from '@/components/ui/new-password-fields'
import { BrandHeading } from '@/components/layout/brand-heading'
import { getApiBaseUrl } from '@/lib/api-client'
import { passwordErrorFromApi, type PasswordRuleError } from '@/lib/password-policy'
import { isUsernameErrorFromApi, isValidUsername } from '@/lib/username-rule'
import { useAuthStore } from '@/stores/auth-store'
import { InstanceSetup } from './instance-setup'

interface SetupWizardProps {
  /** `signedIn`: the new admin is logged in; false sends them to the login page. */
  onComplete: (signedIn: boolean) => void
}

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const { t } = useTranslation()
  const login = useAuthStore((s) => s.login)
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [policyError, setPolicyError] = useState<PasswordRuleError | null>(null)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  // The admin exists and is signed in: the instance steps follow.
  const [adminReady, setAdminReady] = useState(false)

  const usernameValid = isValidUsername(username.trim())
  const passwordReady = newPasswordReady(password, confirmPassword, { username }) && !policyError

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError('')
    if (!username.trim() || !password) {
      setCreateError(t('auth.setup.error_missing_fields'))
      return
    }
    // Each password problem is shown under its field: no banner here.
    if (!usernameValid || !passwordReady || creating) return
    setCreating(true)
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/setup/initialize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password,
          email: email.trim() || null,
          first_name: firstName.trim() || null,
          last_name: lastName.trim() || null,
        }),
      })
      if (res.ok) {
        // Sign the new admin in with the same credentials, so nobody types them twice.
        if (await login(username.trim(), password)) setAdminReady(true)
        else onComplete(false)
        return
      }
      const data = await res.json().catch(() => ({}))
      const policy = passwordErrorFromApi(data)
      if (policy) setPolicyError(policy)
      else if (isUsernameErrorFromApi(data)) setCreateError(t('auth.username_rule.invalid'))
      else setCreateError(typeof data.detail === 'string' ? data.detail : t('auth.setup.error_generic'))
    } catch {
      setCreateError(t('auth.setup.error_generic'))
    } finally {
      setCreating(false)
    }
  }

  if (adminReady) return <InstanceSetup onDone={() => onComplete(true)} />

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <BrandHeading subtitle={t('auth.setup.subtitle')} />
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('auth.setup.admin_title')}</CardTitle>
            <CardDescription className="text-xs">{t('auth.setup.admin_description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <FormField label={t('auth.setup.username')} required>
                {({ id }) => (
                  <>
                    <Input id={id} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
                    <FieldError message={username.trim() && !usernameValid ? t('auth.username_rule.invalid') : null} />
                  </>
                )}
              </FormField>
              <div className="grid grid-cols-2 gap-4">
                <FormField label={t('auth.setup.first_name')}>
                  {({ id }) => (
                    <Input id={id} value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" />
                  )}
                </FormField>
                <FormField label={t('auth.setup.last_name')}>
                  {({ id }) => (
                    <Input id={id} value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" />
                  )}
                </FormField>
              </div>
              <FormField label={t('auth.setup.email')}>
                {({ id }) => (
                  <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                )}
              </FormField>
              <NewPasswordFields
                password={password}
                confirm={confirmPassword}
                onPasswordChange={(v) => {
                  setPassword(v)
                  setPolicyError(null)
                }}
                onConfirmChange={setConfirmPassword}
                username={username}
                serverError={policyError}
                passwordLabel={t('auth.setup.password')}
                confirmLabel={t('auth.setup.password_confirm')}
                required
              />

              {createError && <p className="text-sm text-destructive">{createError}</p>}

              <Button type="submit" className="w-full" disabled={creating || !usernameValid || !passwordReady}>
                {creating && <Loader2 size={14} className="animate-spin" />}
                {creating ? t('auth.setup.creating') : t('auth.setup.create_account')}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
