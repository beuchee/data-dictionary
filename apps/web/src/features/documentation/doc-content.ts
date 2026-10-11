/** `…/content/docs/<lang>/<section>.md` → its language and section id, or null for any other path. */
export function parseDocPath(path: string): { lang: string; section: string } | null {
  const m = /content\/docs\/([^/]+)\/([^/]+)\.md$/.exec(path)
  return m ? { lang: m[1], section: m[2] } : null
}

type Loader = () => Promise<string>

/** `<lang>/<section>` → the lazy import of that Markdown file. */
export function buildDocTable(modules: Record<string, Loader>): Map<string, Loader> {
  const table = new Map<string, Loader>()
  for (const [path, load] of Object.entries(modules)) {
    const doc = parseDocPath(path)
    if (doc) table.set(`${doc.lang}/${doc.section}`, load)
  }
  return table
}

// Each file is its own chunk, fetched when its section is first opened.
const DOC_TABLE = buildDocTable(
  import.meta.glob<string>('/src/content/docs/*/*.md', { query: '?raw', import: 'default' }),
)

/** Whether `section` is written in `lang` (no fallback: a missing file is shown as missing). */
export function hasDoc(lang: string, section: string): boolean {
  return DOC_TABLE.has(`${lang}/${section}`)
}

const cache = new Map<string, Promise<string>>()

/** The raw Markdown of `section` in `lang`; null when that translation does not exist. */
export function loadDoc(lang: string, section: string): Promise<string> | null {
  const key = `${lang}/${section}`
  const load = DOC_TABLE.get(key)
  if (!load) return null
  let pending = cache.get(key)
  if (!pending) {
    pending = load()
    // A failed chunk (offline, redeploy) must be retryable on the next visit.
    pending.catch(() => cache.delete(key))
    cache.set(key, pending)
  }
  return pending
}
