import { toolTag } from '@/lib/export'

const DROP_OTHER_UNITS_KEY = 'dd-sql-drop-other-units'

// TODO(v2-cutover): read the web app's own version at build time; the API's
// appVersion only exists in server mode.
const FALLBACK_APP_VERSION = '2.0.0-dev'

/** The tool tag stamped by exports: this app, at the server's version when known. */
export function defaultToolTag(appVersion: string | null | undefined): string {
  return toolTag(appVersion || FALLBACK_APP_VERSION)
}

/** Today as `YYYY-MM-DD` (UTC, as v1 stamped it). */
export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * "Drop rows in other units", remembered per browser: it reflects how a team
 * wants its SQL exports to behave, as in v1.
 */
export function readDropOtherUnits(): boolean {
  try {
    return localStorage.getItem(DROP_OTHER_UNITS_KEY) === '1'
  } catch {
    return false
  }
}

export function writeDropOtherUnits(on: boolean): void {
  try {
    localStorage.setItem(DROP_OTHER_UNITS_KEY, on ? '1' : '0')
  } catch {
    // Storage full or blocked: the choice simply won't be remembered.
  }
}
