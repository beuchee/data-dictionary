import { useTranslation } from 'react-i18next'
import { LogIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getApiBaseUrl } from '@/lib/api-client'
import { oauthProviders, oauthStartUrl } from '@/lib/oauth'
import { useConfigStore } from '@/stores/config-store'

/**
 * "Sign in with GitHub / GitLab / ORCID", one per provider the server enables
 * (`/instance/config` → `server.authProviders`). Nothing when none is.
 */
export function OAuthButtons() {
  const { t } = useTranslation()
  const providers = oauthProviders(useConfigStore((s) => s.server?.authProviders))
  if (!providers.length) return null

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        {t('oauth.or')}
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="grid gap-2">
        {providers.map((p) => (
          <Button key={p} variant="outline" className="w-full" asChild>
            <a href={oauthStartUrl(getApiBaseUrl(), p)}>
              <LogIn size={14} />
              {t('oauth.sign_in_with', { provider: t(`oauth.provider.${p}`) })}
            </a>
          </Button>
        ))}
      </div>
    </div>
  )
}
