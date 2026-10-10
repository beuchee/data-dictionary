// Adapted from linkr@1310cf4a4 apps/web/src/lib/api-client.ts (without the 428
// database-login prompt and the deferred-task polling, which this app does not have).

/**
 * API client for server mode: fetch with JWT auth headers and automatic token refresh.
 */

const ACCESS_TOKEN_KEY = 'dd-access-token'
const REFRESH_TOKEN_KEY = 'dd-refresh-token'
const AUTH_USER_KEY = 'dd-auth-user'

let refreshPromise: Promise<boolean> | null = null

export function isServerMode(): boolean {
  return !!import.meta.env.VITE_API_URL
}

export function getApiBaseUrl(): string {
  // In dev, the Vite proxy forwards /api/* to the API; in prod VITE_API_URL points to it.
  // The trailing slash comes off so VITE_API_URL="/" (nginx routing relative paths)
  // yields "" and callers can join `${base}/api/v1/...`.
  return (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
}

function getStoredToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY)
}

function getStoredRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY)
}

export function clearStoredTokens(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
  localStorage.removeItem(AUTH_USER_KEY)
}

export function setStoredTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
}

async function refreshTokens(): Promise<boolean> {
  const refreshToken = getStoredRefreshToken()
  if (!refreshToken) return false

  try {
    const res = await fetch(`${getApiBaseUrl()}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })

    if (!res.ok) {
      clearStoredTokens()
      return false
    }

    const data = await res.json()
    setStoredTokens(data.access_token, data.refresh_token)
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user))
    return true
  } catch {
    clearStoredTokens()
    return false
  }
}

function withAuth(options: RequestInit, token: string | null): Headers {
  const headers = new Headers(options.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json')
  }
  return headers
}

/**
 * Fetch wrapper that adds the Authorization header and, on a 401, refreshes the
 * tokens once and retries. Concurrent 401s share a single refresh.
 */
export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const url = `${getApiBaseUrl()}${path}`
  let res = await fetch(url, { ...options, headers: withAuth(options, getStoredToken()) })

  if (res.status === 401 && getStoredRefreshToken()) {
    if (!refreshPromise) {
      refreshPromise = refreshTokens().finally(() => {
        refreshPromise = null
      })
    }
    if (await refreshPromise) {
      res = await fetch(url, { ...options, headers: withAuth(options, getStoredToken()) })
    }
  }

  return res
}

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** Typed JSON request: prefixes /api/v1, adds auth + refresh, throws ApiError on failure. */
export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(`/api/v1${path}`, init)
  if (!res.ok) {
    throw new ApiError(res.status, await res.text())
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}
