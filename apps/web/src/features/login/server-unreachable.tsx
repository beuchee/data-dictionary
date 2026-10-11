// Adapted from linkr@1310cf4a4 apps/web/src/features/login/ServerUnreachable.tsx (instance branding)
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, ServerCrash } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Server mode, and the API did not answer the setup check: down, wrong URL, or
 * refusing to boot (insecure secret, wildcard CORS). Distinct from the login page
 * so nobody is handed a form that can only fail.
 */
export function ServerUnreachable() {
  const { t } = useTranslation()
  const checkSetupStatus = useAuthStore((s) => s.checkSetupStatus)
  const [retrying, setRetrying] = useState(false)

  const handleRetry = async () => {
    setRetrying(true)
    await checkSetupStatus()
    setRetrying(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <EmptyState
        icon={ServerCrash}
        title={t('auth.unreachable.title')}
        description={t('auth.unreachable.description')}
        action={
          <Button variant="outline" onClick={handleRetry} disabled={retrying}>
            {retrying && <Loader2 size={14} className="animate-spin" />}
            {t('auth.unreachable.retry')}
          </Button>
        }
      />
    </div>
  )
}
