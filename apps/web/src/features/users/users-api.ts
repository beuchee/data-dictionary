import { ApiError, apiRequest } from '@/lib/api-client'

export interface IdentitySummary {
  id: number
  provider: string
  username: string | null
  email: string | null
  createdAt: string | null
}

/** `GET /users` row. */
export interface AdminUser {
  id: number
  username: string
  email: string | null
  firstName: string | null
  lastName: string | null
  role: string
  isActive: boolean
  lastLogin: string | null
  createdAt: string | null
  hasPassword: boolean
  /** An administrator chose the current password; the user is asked for a new one at sign-in. */
  mustChangePassword: boolean
  identities: IdentitySummary[]
}

/** `POST /users` body; without `password` the server generates one. */
export interface NewUser {
  username: string
  email: string | null
  firstName: string | null
  lastName: string | null
  role: string
  password?: string
}

/** `POST /users` answer: the generated password, shown once, when none was given. */
export interface CreatedUser extends AdminUser {
  temporaryPassword: string | null
}

export interface RoleInfo {
  name: string
  label: Record<string, string>
  isSystem: boolean
  permissions: string[]
}

export interface RolesInfo {
  roles: RoleInfo[]
  catalogue: Record<string, string[]>
}

const json = (body: unknown): RequestInit => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const usersApi = {
  list: () => apiRequest<AdminUser[]>('/users'),
  roles: () => apiRequest<RolesInfo>('/roles'),
  create: (user: NewUser) => apiRequest<CreatedUser>('/users', { method: 'POST', ...json(user) }),
  update: (id: number, patch: { role?: string; isActive?: boolean }) =>
    apiRequest<AdminUser>(`/users/${id}`, { method: 'PATCH', ...json(patch) }),
  resetPassword: (id: number, password: string) =>
    apiRequest<AdminUser>(`/users/${id}/reset-password`, { method: 'POST', ...json({ password }) }),
}

/** The `{code}` of an API refusal (`last_admin`, `self_deactivation`, `admin_only`…), when it has one. */
export function apiErrorCode(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null
  try {
    const detail = (JSON.parse(error.message) as { detail?: unknown }).detail
    if (detail && typeof detail === 'object' && 'code' in detail) return String((detail as { code: unknown }).code)
  } catch {
    // not JSON
  }
  return null
}

/** "First Last", else null. */
export function fullName(user: Pick<AdminUser, 'firstName' | 'lastName'>): string | null {
  const name = [user.firstName, user.lastName].map((s) => s?.trim()).filter(Boolean).join(' ')
  return name || null
}
