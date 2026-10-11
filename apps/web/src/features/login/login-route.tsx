import { Navigate, useLocation, useNavigate, type Location } from 'react-router'
import { isServerMode } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth-store'
import { anonymousReadAllowed, useConfigStore } from '@/stores/config-store'
import { LoginPage } from './login-page'

/** `/login`, reached from the header's "Log in": back where the user was once signed in. */
export function LoginRoute() {
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const anonymousRead = useConfigStore(anonymousReadAllowed)
  const from = (location.state as { from?: Location } | null)?.from
  const target = from && from.pathname !== '/login' ? `${from.pathname}${from.search}` : '/'

  if (!isServerMode() || user) return <Navigate to={target} replace />
  const back = () => navigate(target, { replace: true })
  return <LoginPage onSuccess={back} onContinueAnonymously={anonymousRead ? back : undefined} />
}
