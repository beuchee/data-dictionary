import { openDB, type IDBPDatabase } from 'idb'
import { parse, serialize } from '@data-dictionary/format'
import type { Draft, DraftContentByKind, DraftKind, DraftOf, DraftStore, NewDraft } from './types'

/**
 * A draft as stored in the browser: the content as its file's canonical text,
 * since IndexedDB's structured clone would turn a `RawNumber` (a `1.0` lexeme)
 * into a plain object.
 */
export interface DraftRecord {
  id: string
  kind: DraftKind
  targetId: number | null
  baseCommit: string | null
  contentText: string
  createdAt: string
  updatedAt: string
}

/** Key-value storage of draft records: IndexedDB in the browser, memory in tests. */
export interface DraftBackend {
  all(): Promise<DraftRecord[]>
  get(id: string): Promise<DraftRecord | undefined>
  put(record: DraftRecord): Promise<void>
  delete(id: string): Promise<void>
}

export class MemoryDraftBackend implements DraftBackend {
  private readonly records = new Map<string, DraftRecord>()

  async all(): Promise<DraftRecord[]> {
    return [...this.records.values()].map((r) => ({ ...r }))
  }

  async get(id: string): Promise<DraftRecord | undefined> {
    const r = this.records.get(id)
    return r && { ...r }
  }

  async put(record: DraftRecord): Promise<void> {
    this.records.set(record.id, { ...record })
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id)
  }
}

const DB_NAME = 'dd-drafts'
const STORE = 'drafts'

/** IndexedDB database `dd-drafts`, object store `drafts` keyed by `id`. */
export function indexedDbDraftBackend(): DraftBackend {
  let db: Promise<IDBPDatabase> | null = null
  const open = () => {
    db ??= openDB(DB_NAME, 1, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, { keyPath: 'id' })
      },
    })
    return db
  }
  return {
    all: async () => (await open()).getAll(STORE) as Promise<DraftRecord[]>,
    get: async (id) => (await open()).get(STORE, id) as Promise<DraftRecord | undefined>,
    put: async (record) => {
      await (await open()).put(STORE, record)
    },
    delete: async (id) => {
      await (await open()).delete(STORE, id)
    },
  }
}

function toRecord(draft: Draft): DraftRecord {
  const { content, ...rest } = draft
  return { ...rest, contentText: serialize(content, { kind: draft.kind }) }
}

function fromRecord(record: DraftRecord): Draft {
  const { contentText, ...rest } = record
  return { ...rest, content: parse(contentText) } as Draft
}

export interface LocalDraftStoreOptions {
  now?: () => string
  newId?: () => string
}

/** Static mode: drafts kept in this browser (v1 kept them in localStorage). */
export class LocalDraftStore implements DraftStore {
  readonly mode = 'static' as const
  private readonly backend: DraftBackend
  private readonly now: () => string
  private readonly newId: () => string

  constructor(backend: DraftBackend = indexedDbDraftBackend(), options: LocalDraftStoreOptions = {}) {
    this.backend = backend
    this.now = options.now ?? (() => new Date().toISOString())
    this.newId = options.newId ?? (() => crypto.randomUUID())
  }

  async list(): Promise<Draft[]> {
    const records = await this.backend.all()
    return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(fromRecord)
  }

  async get(id: string): Promise<Draft | null> {
    const record = await this.backend.get(id)
    return record ? fromRecord(record) : null
  }

  async create<K extends DraftKind>(draft: NewDraft<K>): Promise<DraftOf<K>> {
    const at = this.now()
    const created = {
      id: this.newId(),
      kind: draft.kind,
      targetId: draft.targetId,
      baseCommit: draft.baseCommit ?? null,
      content: draft.content,
      createdAt: at,
      updatedAt: at,
    } as DraftOf<K>
    await this.backend.put(toRecord(created))
    return fromRecord(toRecord(created)) as DraftOf<K>
  }

  async update<K extends DraftKind>(id: string, content: DraftContentByKind[K]): Promise<DraftOf<K>> {
    const record = await this.backend.get(id)
    if (!record) throw new Error(`Draft ${id} not found`)
    const next = { ...fromRecord(record), content, updatedAt: this.now() } as Draft
    await this.backend.put(toRecord(next))
    return fromRecord(toRecord(next)) as DraftOf<K>
  }

  async remove(id: string): Promise<void> {
    await this.backend.delete(id)
  }
}
