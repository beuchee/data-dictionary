/**
 * OAuth sign-in (server mode). The API runs the whole flow
 * (`/auth/oauth/{provider}/start` → provider → `/auth/oauth/{provider}/callback`)
 * and lands on the web app's `/auth/callback` with the outcome in the URL
 * fragment, never in the query (it stays out of server logs and Referer):
 * `#access_token=…&refresh_token=…&provider=…[&linked=1]` or `#error=<code>`.
 */

export const OAUTH_PROVIDERS = ['github', 'gitlab', 'orcid'] as const
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number]

export type OAuthCallback =
  | { ok: true; accessToken: string; refreshToken: string; provider: string | null; linked: boolean }
  | { ok: false; error: string }

/** The providers to offer: `server.authProviders` minus `local`, known ones only, in a fixed order. */
export function oauthProviders(authProviders: readonly string[] | null | undefined): OAuthProvider[] {
  const enabled = new Set(authProviders ?? [])
  return OAUTH_PROVIDERS.filter((p) => enabled.has(p))
}

/** Where a sign-in button points: the API redirects to the provider. */
export function oauthStartUrl(apiBase: string, provider: OAuthProvider): string {
  return `${apiBase.replace(/\/+$/, '')}/api/v1/auth/oauth/${provider}/start?redirect=true`
}

/**
 * The outcome carried by `/auth/callback`'s fragment; null when the fragment
 * holds neither tokens nor an error (opened by hand). An error code is kept
 * only when it looks like one (`invalid_state`, `identity_in_use`…).
 */
export function parseOAuthFragment(hash: string): OAuthCallback | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const error = params.get('error')
  if (error !== null) return { ok: false, error: /^[a-z_]{1,64}$/.test(error) ? error : 'unknown' }
  const accessToken = params.get('access_token')
  const refreshToken = params.get('refresh_token')
  if (!accessToken || !refreshToken) return null
  return { ok: true, accessToken, refreshToken, provider: params.get('provider'), linked: params.get('linked') === '1' }
}
