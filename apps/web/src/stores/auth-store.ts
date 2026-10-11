// Adapted from linkr@1310cf4a4 apps/web/src/stores/auth-store.ts (dd- storage keys; no
// terminals, trusted-header login or export masking; profile and password actions added).
import { create } from 'zustand'
import {
  ACCESS_TOKEN_KEY,
  AUTH_USER_KEY,
  REFRESH_TOKEN_KEY,
  apiRequest,
  clearStoredTokens,
  getApiBaseUrl,
  isServerMode,
  setStoredTokens,
} from '@/lib/api-client'
import { jwtSubject } from '@/lib/jwt'
import { setPasswordMinLength } from '@/lib/password-policy'

export interface AuthUser {
  id: number
  username: string
  email: string | null
  role: string
  is_active: boolean
  /** From GET /auth/me; absent right after login (lighter shape), so treat absence as "no". */
  permissions?: string[]
  // Profile (snake_case, as the auth API returns it). They feed a concept set's
  // `createdByDetails` and its reviews.
  first_name?: string | null
  last_name?: string | null
  affiliation?: string | null
  profession?: string | null
  orcid?: string | null
  preferences?: Record<string, unknown>
}

/** PATCH /auth/me body; camelCase like a concept set's `createdByDetails`. */
export interface ProfileChanges {
  email?: string | null
  firstName?: string | null
  lastName?: string | null
  affiliation?: string | null
  profession?: string | null
  orcid?: string | null
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  user: AuthUser
}

export type LoginError = 'invalid_credentials' | 'server_error' | 'unreachable'

interface AuthState {
  token: string | null
  refreshToken: string | null
  user: AuthUser | null
  /** null = not checked yet. */
  needsSetup: boolean | null
  isCheckingAuth: boolean
  /** Server mode, and the backend did not answer the setup check. */
  serverUnreachable: boolean
  loginError: LoginError | null

  checkSetupStatus: () => Promise<void>
  login: (username: string, password: string) => Promise<boolean>
  logout: () => void
  validateToken: () => Promise<boolean>
  setTokens: (accessToken: string, refreshToken: string, user: AuthUser) => void
  /** Throws an ApiError when refused (422 for an invalid ORCID iD). */
  updateProfile: (changes: ProfileChanges) => Promise<void>
  /** Throws an ApiError when refused (403 wrong current password, 422 policy). */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
}

function loadStoredAuth(): Pick<AuthState, 'token' | 'refreshToken' | 'user'> {
  if (!isServerMode()) return { token: null, refreshToken: null, user: null }
  let user: AuthUser | null = null
  try {
    const raw = localStorage.getItem(AUTH_USER_KEY)
    user = raw ? (JSON.parse(raw) as AuthUser) : null
  } catch {
    user = null
  }
  return {
    token: localStorage.getItem(ACCESS_TOKEN_KEY),
    refreshToken: localStorage.getItem(REFRESH_TOKEN_KEY),
    user,
  }
}

/** Whether `user` holds `permission`. Static mode has no auth: everything is allowed. */
export function userHasPermission(user: AuthUser | null, permission: string, serverMode = isServerMode()): boolean {
  if (!serverMode) return true
  if (user?.role === 'admin') return true // hard super-admin, as on the backend
  return !!user?.permissions?.includes(permission)
}

export function useHasPermission(permission: string): boolean {
  const user = useAuthStore((s) => s.user)
  return userHasPermission(user, permission)
}

/** "First Last", else the username. */
export function displayName(user: Pick<AuthUser, 'username' | 'first_name' | 'last_name'>): string {
  const full = [user.first_name, user.last_name]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(' ')
  return full || user.username
}

/** Up to two initials for the avatar. */
export function initials(user: Pick<AuthUser, 'username' | 'first_name' | 'last_name'>): string {
  const first = user.first_name?.trim()
  const last = user.last_name?.trim()
  if (first || last) return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase()
  return user.username.slice(0, 2).toUpperCase()
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  ...loadStoredAuth(),
  needsSetup: null,
  isCheckingAuth: false,
  serverUnreachable: false,
  loginError: null,

  checkSetupStatus: async () => {
    if (!isServerMode()) return
    set({ isCheckingAuth: true })
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/setup/status`)
      if (res.ok) {
        const data = await res.json()
        if (typeof data.password_min_length === 'number') setPasswordMinLength(data.password_min_length)
        set({ needsSetup: data.needs_setup, isCheckingAuth: false, serverUnreachable: false })
      } else {
        // 502-504 come from the reverse proxy: it answered, the API behind it did not.
        const unreachable = res.status >= 502 && res.status <= 504
        set({ needsSetup: false, isCheckingAuth: false, serverUnreachable: unreachable })
      }
    } catch {
      set({ needsSetup: false, isCheckingAuth: false, serverUnreachable: true })
    }
  },

  login: async (username, password) => {
    set({ loginError: null })
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      if (!res.ok) {
        set({ loginError: res.status === 401 ? 'invalid_credentials' : 'server_error' })
        return false
      }
      const data = (await res.json()) as TokenResponse
      get().setTokens(data.access_token, data.refresh_token, data.user)
      // Login returns the light user shape: /auth/me adds the permissions.
      await get().validateToken()
      return true
    } catch {
      set({ loginError: 'unreachable' })
      return false
    }
  },

  logout: () => {
    const { token } = get()
    if (token) {
      // Best effort: tokens are stateless, the server only drops session state.
      fetch(`${getApiBaseUrl()}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => undefined)
    }
    clearStoredTokens()
    set({ token: null, refreshToken: null, user: null })
  },

  validateToken: async () => {
    const fetchMe = () =>
      fetch(`${getApiBaseUrl()}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${get().token}` } })
    if (!get().token) return false
    try {
      let res = await fetchMe()
      if (res.status === 401) {
        const refreshToken = get().refreshToken
        const refreshRes = refreshToken
          ? await fetch(`${getApiBaseUrl()}/api/v1/auth/refresh`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ refresh_token: refreshToken }),
            })
          : null
        if (!refreshRes?.ok) {
          get().logout()
          return false
        }
        const data = (await refreshRes.json()) as TokenResponse
        get().setTokens(data.access_token, data.refresh_token, data.user)
        res = await fetchMe()
      }
      // Any other failure (5xx…) keeps the cached session: the next call retries.
      if (!res.ok) return false
      const user = (await res.json()) as AuthUser
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user))
      set({ user })
      return true
    } catch {
      return false
    }
  },

  setTokens: (accessToken, refreshToken, user) => {
    setStoredTokens(accessToken, refreshToken)
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user))
    set({ token: accessToken, refreshToken, user, loginError: null })
  },

  updateProfile: async (changes) => {
    const user = await apiRequest<AuthUser>('/auth/me', { method: 'PATCH', body: JSON.stringify(changes) })
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user))
    set({ user })
  },

  changePassword: async (currentPassword, newPassword) => {
    const data = await apiRequest<TokenResponse>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    })
    // Every earlier session ended with the change: these are the new tokens. The
    // response carries the light user shape, so keep the profile we already have.
    get().setTokens(data.access_token, data.refresh_token, { ...get().user, ...data.user })
  },
}))

// Another tab logging out (or failing to refresh) removes the shared tokens, and one
// logging in as someone else replaces them: follow it, so this tab never keeps
// showing one account while its requests carry another's token. A refresh of the
// same user's token changes nothing visible.
if (typeof window !== 'undefined' && isServerMode()) {
  window.addEventListener('storage', (event) => {
    if (event.key !== ACCESS_TOKEN_KEY && event.key !== null) return
    const stored = loadStoredAuth()
    const { token } = useAuthStore.getState()
    if (stored.token === null) {
      if (token !== null) useAuthStore.setState({ token: null, refreshToken: null, user: null })
    } else if (jwtSubject(stored.token) !== jwtSubject(token)) {
      useAuthStore.setState(stored)
    } else {
      useAuthStore.setState({ token: stored.token, refreshToken: stored.refreshToken })
    }
  })
}
