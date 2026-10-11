import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { BrandHeading } from '@/components/layout/brand-heading'
import { parseOAuthFragment, type OAuthCallback } from '@/lib/oauth'
import { useAuthStore } from '@/stores/auth-store'

type State =
  | { kind: 'working' }
  | { kind: 'empty' }
  | { kind: 'error'; code: string }
  | { kind: 'linked'; provider: string | null }

/** Read once: the fragment is cleared from the address bar as soon as it is read. */
let consumed: OAuthCallback | null | undefined

function readFragment(): OAuthCallback | null {
  if (consumed === undefined) {
    consumed = parseOAuthFragment(window.location.hash)
    if (window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
  }
  return consumed
}

/**
 * `/auth/callback`: where the API sends the browser back after an OAuth
 * sign-in (docs/architecture.md, OAuth). Stores the token pair like a password
 * login and goes home; a linked identity says so first; an error explains.
 */
export function OAuthCallbackPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const acceptTokens = useAuthStore((s) => s.acceptTokens)
  const [state, setState] = useState<State>({ kind: 'working' })

  useEffect(() => {
    let cancelled = false
    const outcome = readFragment()
    const run = async () => {
      if (!outcome) return setState({ kind: 'empty' })
      if (!outcome.ok) return setState({ kind: 'error', code: outcome.error })
      const ok = await acceptTokens(outcome.accessToken, outcome.refreshToken)
      if (cancelled) return
      if (!ok) return setState({ kind: 'error', code: 'validation_failed' })
      if (outcome.linked) return setState({ kind: 'linked', provider: outcome.provider })
      navigate('/', { replace: true })
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [acceptTokens, navigate])

  const providerName = (p: string | null) => (p ? t(`oauth.provider.${p}`, { defaultValue: p }) : '')

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <BrandHeading />
        <Card>
          <CardContent className="space-y-4">
            {state.kind === 'working' && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 size={14} className="animate-spin" />
                {t('oauth.callback.signing_in')}
              </p>
            )}
            {state.kind === 'empty' && <p className="text-sm text-muted-foreground">{t('oauth.callback.empty')}</p>}
            {state.kind === 'error' && (
              <NoticeBanner
                tone="danger"
                title={t('oauth.callback.failed_title')}
                description={t(`oauth.callback.error.${state.code}`, { defaultValue: t('oauth.callback.error.unknown') })}
              />
            )}
            {state.kind === 'linked' && (
              <p className="flex items-start gap-2 text-sm">
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-primary" />
                {t('oauth.callback.linked', { provider: providerName(state.provider) })}
              </p>
            )}
            {state.kind !== 'working' && (
              <Button
                className="w-full"
                variant={state.kind === 'linked' ? 'default' : 'outline'}
                onClick={() => navigate(state.kind === 'linked' ? '/' : '/login', { replace: true })}
              >
                {state.kind === 'linked' ? t('oauth.callback.home') : t('oauth.callback.back')}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
