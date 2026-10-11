// Static mode: imports kept in this browser's IndexedDB, as v1 kept its
// mapping projects in localStorage (rows are too large for it).
import type { MappingImportDetail, MappingImportSummary, MappingSource, NewMappingImport } from './types'

const DB_NAME = 'dd-mappings'
const SUMMARIES = 'imports'
const ROWS = 'rows'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(SUMMARIES)) db.createObjectStore(SUMMARIES, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(ROWS)) db.createObjectStore(ROWS)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function run<T>(
  stores: string[],
  mode: 'readonly' | 'readwrite',
  body: (tx: IDBTransaction) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await open()
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(stores, mode)
      const req = body(tx)
      tx.oncomplete = () => resolve(req ? req.result : undefined)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

/** The summary of a new import, from what the browser parsed. */
export function summaryOf(input: NewMappingImport, id: string, createdAt: string): MappingImportSummary {
  return {
    id,
    name: input.name.trim() || input.parsed.suggestedName || input.files[0]?.name || id,
    description: input.description.trim() || null,
    format: input.parsed.format,
    sourceFileName: input.files.map((f) => f.name).join(', '),
    options: { ...input.options, format: input.parsed.format },
    stats: input.parsed.stats,
    warnings: input.parsed.warnings,
    defaultStatuses: input.parsed.defaultStatuses,
    createdBy: null,
    createdAt,
  }
}

export class LocalMappingSource implements MappingSource {
  readonly kind = 'local' as const

  async list(): Promise<MappingImportSummary[]> {
    const all = (await run<MappingImportSummary[]>([SUMMARIES], 'readonly', (tx) => tx.objectStore(SUMMARIES).getAll())) ?? []
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async get(id: string): Promise<MappingImportDetail | null> {
    const db = await open()
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction([SUMMARIES, ROWS], 'readonly')
        const s = tx.objectStore(SUMMARIES).get(id)
        const r = tx.objectStore(ROWS).get(id)
        tx.oncomplete = () => resolve(s.result && r.result ? { ...(s.result as MappingImportSummary), rows: r.result } : null)
        tx.onerror = () => reject(tx.error)
      })
    } finally {
      db.close()
    }
  }

  async create(input: NewMappingImport): Promise<MappingImportSummary> {
    const summary = summaryOf(input, crypto.randomUUID(), new Date().toISOString())
    await run([SUMMARIES, ROWS], 'readwrite', (tx) => {
      tx.objectStore(SUMMARIES).put(summary)
      tx.objectStore(ROWS).put(input.parsed.rows, summary.id)
    })
    return summary
  }

  async remove(id: string): Promise<void> {
    await run([SUMMARIES, ROWS], 'readwrite', (tx) => {
      tx.objectStore(SUMMARIES).delete(id)
      tx.objectStore(ROWS).delete(id)
    })
  }
}
