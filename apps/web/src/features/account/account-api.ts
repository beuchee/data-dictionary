import { apiRequest } from '@/lib/api-client'
import type { IdentitySummary } from '@/features/users/users-api'

/** `GET /auth/api-tokens` row (the plaintext is never listed). */
export interface ApiToken {
  id: string
  name: string
  prefix: string
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
}

/** `POST /auth/api-tokens`: the only answer carrying the token itself. */
export interface CreatedApiToken extends ApiToken {
  token: string
}

export interface AccountIdentities {
  hasPassword: boolean
  identities: IdentitySummary[]
}

const json = (body: unknown): RequestInit => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export const accountApi = {
  listTokens: () => apiRequest<ApiToken[]>('/auth/api-tokens'),
  createToken: (name: string, expiresInDays: number | null) =>
    apiRequest<CreatedApiToken>('/auth/api-tokens', { method: 'POST', ...json({ name, expiresInDays }) }),
  revokeToken: (id: string) => apiRequest<ApiToken>(`/auth/api-tokens/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  identities: () => apiRequest<AccountIdentities>('/auth/identities'),
  unlink: (id: number) => apiRequest<AccountIdentities>(`/auth/identities/${id}`, { method: 'DELETE' }),
  /** Starts linking `provider` to the signed-in account: the provider's authorization URL. */
  linkStart: async (provider: string) =>
    (await apiRequest<{ authorizationUrl: string }>(`/auth/oauth/${encodeURIComponent(provider)}/start`)).authorizationUrl,
}

export type TokenState = 'active' | 'revoked' | 'expired'

/** Whether a token still works at `now`. */
export function tokenState(token: Pick<ApiToken, 'revokedAt' | 'expiresAt'>, now: Date = new Date()): TokenState {
  if (token.revokedAt) return 'revoked'
  if (token.expiresAt && new Date(token.expiresAt).getTime() <= now.getTime()) return 'expired'
  return 'active'
}

/** The OAuth providers an account may link: the enabled ones it has not linked yet. */
export function linkableProviders(enabled: readonly string[], identities: readonly Pick<IdentitySummary, 'provider'>[]): string[] {
  const linked = new Set(identities.map((i) => i.provider))
  return enabled.filter((p) => p !== 'local' && !linked.has(p))
}

/** Whether unlinking would leave the account with no way to sign in (the API refuses it too). */
export function isLastSignInMethod(account: AccountIdentities): boolean {
  return !account.hasPassword && account.identities.length <= 1
}
