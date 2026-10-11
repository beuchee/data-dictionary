// Adapted from linkr@1310cf4a4 apps/web/src/features/login/LoginPage.tsx (instance branding,
// "continue without signing in" when anonymous reading is allowed).
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { BrandHeading } from '@/components/layout/brand-heading'
import { useAuthStore } from '@/stores/auth-store'

interface LoginPageProps {
  setupJustCompleted?: boolean
  /** Shown as "Continue without signing in" when the dictionary is readable anonymously. */
  onContinueAnonymously?: () => void
  /** Called once signed in. */
  onSuccess?: () => void
}

export function LoginPage({ setupJustCompleted, onContinueAnonymously, onSuccess }: LoginPageProps) {
  const { t } = useTranslation()
  const login = useAuthStore((s) => s.login)
  const loginError = useAuthStore((s) => s.loginError)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username || !password || loading) return
    setLoading(true)
    const ok = await login(username, password)
    setLoading(false)
    if (ok) onSuccess?.()
  }

  const errorKey =
    loginError === 'invalid_credentials'
      ? 'auth.login.error'
      : loginError === 'unreachable'
        ? 'auth.login.server_unreachable'
        : 'auth.login.server_error'

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <BrandHeading subtitle={onContinueAnonymously ? t('auth.login.subtitle') : t('auth.login.login_required')} />

        {setupJustCompleted && (
          <p className="rounded-md border bg-muted/40 p-3 text-center text-sm text-foreground">
            {t('auth.login.setup_complete')}
          </p>
        )}

        <Card>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <FormField label={t('auth.login.username')}>
                {({ id }) => (
                  <Input
                    id={id}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    autoFocus
                  />
                )}
              </FormField>
              <FormField label={t('auth.login.password')}>
                {({ id }) => (
                  <PasswordInput
                    id={id}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                )}
              </FormField>

              {loginError && <p className="text-sm text-destructive">{t(errorKey)}</p>}

              <Button type="submit" className="w-full" disabled={loading || !username || !password}>
                {loading && <Loader2 size={14} className="animate-spin" />}
                {loading ? t('auth.login.signing_in') : t('auth.login.submit')}
              </Button>
            </form>
          </CardContent>
        </Card>

        {onContinueAnonymously && (
          <div className="text-center">
            <Button variant="link" size="sm" onClick={onContinueAnonymously}>
              {t('auth.login.continue_anonymously')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
