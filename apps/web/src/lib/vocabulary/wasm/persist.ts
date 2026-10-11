/**
 * IndexedDB persistence of the browser vocabulary (as v1's duckdb-loader.js):
 * after an import, the database is exported to Parquet (EXPORT DATABASE) and
 * every exported file stored here; the next visit re-imports them instead of
 * asking for the ATHENA folder again. One record per file, plus the metadata.
 */

const DB_NAME = 'dd-vocabulary'
const FILES = 'files'
const META = 'meta'

export interface StoredVocabularyMeta {
  /** Bumped when the stored layout changes: an older store is dropped. */
  formatVersion: number
  importedAt: string
  /** The folder the files were picked from. */
  source: string
  /** Rows per table at import time. */
  rowCounts: Record<string, number>
  /** Whether concept_relationship / concept_synonym were cut to the dictionary's concepts. */
  filtered: boolean
}

export const STORE_FORMAT_VERSION = 1

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES)
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function transaction<T>(
  stores: string[],
  mode: 'readonly' | 'readwrite',
  run: (tx: IDBTransaction) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await open()
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(stores, mode)
      const req = run(tx)
      tx.oncomplete = () => resolve(req ? req.result : undefined)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
    })
  } finally {
    db.close()
  }
}

/** Replace the stored vocabulary with `files` (path → bytes) and `meta`. */
export async function storeVocabulary(files: Map<string, Uint8Array>, meta: StoredVocabularyMeta): Promise<void> {
  await transaction([FILES, META], 'readwrite', (tx) => {
    const store = tx.objectStore(FILES)
    store.clear()
    for (const [path, bytes] of files) store.put(bytes, path)
    tx.objectStore(META).put(meta, 'meta')
  })
}

export async function readMeta(): Promise<StoredVocabularyMeta | null> {
  const meta = await transaction<StoredVocabularyMeta>([META], 'readonly', (tx) => tx.objectStore(META).get('meta'))
  return meta && meta.formatVersion === STORE_FORMAT_VERSION ? meta : null
}

export async function readFiles(): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>()
  const db = await open()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([FILES], 'readonly')
      const req = tx.objectStore(FILES).openCursor()
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) return
        files.set(String(cursor.key), cursor.value as Uint8Array)
        cursor.continue()
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
  return files
}

export async function clearVocabulary(): Promise<void> {
  await transaction([FILES, META], 'readwrite', (tx) => {
    tx.objectStore(FILES).clear()
    tx.objectStore(META).clear()
  })
}
