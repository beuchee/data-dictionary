/**
 * Usernames of accounts created by the setup or an administrator. Twin of
 * `USERNAME_PATTERN` in `apps/api/app/core/security.py`, which enforces it
 * (422 `username_invalid`); accounts created before the rule keep their name.
 */
export const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,64}$/

export function isValidUsername(username: string): boolean {
  return USERNAME_PATTERN.test(username)
}

/** Whether a refused request is the server's `username_invalid`. */
export function isUsernameErrorFromApi(source: unknown): boolean {
  let body = source instanceof Error ? source.message : source
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch { return false }
  }
  const detail = (body as { detail?: unknown } | null)?.detail as { code?: unknown } | undefined
  return detail?.code === 'username_invalid'
}
