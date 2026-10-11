// Adapted from linkr@1310cf4a4 apps/web/src/app/AuthGate.tsx (anonymous reading, catalog reset
// on identity change, no app-store user mirror).
import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { LoginPage } from '@/features/login/login-page'
import { ServerUnreachable } from '@/features/login/server-unreachable'
import { SetupWizard } from '@/features/setup/setup-wizard'
import { isServerMode } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth-store'
import { useCatalogStore } from '@/stores/catalog-store'
import { anonymousReadAllowed, useConfigStore } from '@/stores/config-store'

interface AuthGateProps {
  children: React.ReactNode
}

/**
 * Static mode: pass-through (no login, everything local). Server mode: first-run
 * setup, then the app, readable anonymously when the instance allows it
 * (`access.anonymousRead`), else only once signed in.
 */
export function AuthGate({ children }: AuthGateProps) {
  const serverMode = isServerMode()
  const needsSetup = useAuthStore((s) => s.needsSetup)
  const isCheckingAuth = useAuthStore((s) => s.isCheckingAuth)
  const serverUnreachable = useAuthStore((s) => s.serverUnreachable)
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  const checkSetupStatus = useAuthStore((s) => s.checkSetupStatus)
  const validateToken = useAuthStore((s) => s.validateToken)
  const anonymousRead = useConfigStore(anonymousReadAllowed)
  const [setupJustCompleted, setSetupJustCompleted] = useState(false)
  const [validatingToken, setValidatingToken] = useState(false)

  useEffect(() => {
    if (serverMode) checkSetupStatus()
  }, [serverMode, checkSetupStatus])

  // Revalidate a stored token once per token: the cached user is a stale snapshot
  // without fresh permissions. Block only when there is no cached user to show.
  useEffect(() => {
    if (!(serverMode && needsSetup === false && token)) return
    let cancelled = false
    const blocking = !useAuthStore.getState().user
    const run = async () => {
      if (blocking) setValidatingToken(true)
      try {
        await validateToken()
      } finally {
        if (!cancelled && blocking) setValidatingToken(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [serverMode, needsSetup, token, validateToken])

  // What is readable depends on who is signed in: drop what was loaded for someone else.
  const userId = user?.id ?? null
  const previousUserId = useRef(userId)
  useEffect(() => {
    if (previousUserId.current !== userId) useCatalogStore.getState().reset()
    previousUserId.current = userId
  }, [userId])

  if (!serverMode) return <>{children}</>

  if (isCheckingAuth || needsSetup === null || validatingToken) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (serverUnreachable) return <ServerUnreachable />

  if (needsSetup) {
    return (
      <SetupWizard
        onComplete={(signedIn) => {
          setSetupJustCompleted(!signedIn)
          checkSetupStatus()
        }}
      />
    )
  }

  if (!user && !anonymousRead) return <LoginPage setupJustCompleted={setupJustCompleted} />

  return <>{children}</>
}
