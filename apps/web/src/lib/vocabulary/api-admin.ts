/** Server mode: the vocabulary library's administration (`settings:manage`). */
import { ACCESS_TOKEN_KEY, ApiError, apiRequest, getApiBaseUrl } from '@/lib/api-client'
import type { VocabularySummary } from './types'

export interface LibraryVocabulary extends VocabularySummary {
  release: string | null
  rowCounts: Record<string, number>
  /** A server folder, or `upload`. */
  source: string
  importedAt: string
  sizeBytes: number
}

export interface ImportJob {
  id: string
  status: 'running' | 'done' | 'error'
  /** The table being written. */
  step: string
  done: number
  total: number
  error: string | null
  vocabularies: { vocabularyId: string; rowCounts: Record<string, number> }[]
}

export interface LibraryStatus {
  available: boolean
  release: string | null
  vocabularies: LibraryVocabulary[]
  rowCounts: Record<string, number>
  busy: boolean
  jobs: ImportJob[]
  /** Server folders an import may read; empty = uploads only. */
  importRoots: string[]
}

export interface ExportSource {
  uploadId?: string
  serverPath?: string
}

export interface InspectedVocabulary extends VocabularySummary {
  inLibrary: boolean
  libraryVersion: string | null
}

export interface InspectedExport {
  release: string | null
  tables: string[]
  vocabularies: InspectedVocabulary[]
}

const V = '/vocabulary'

export const getLibraryStatus = () => apiRequest<LibraryStatus>(`${V}/status`)

export const createUpload = () =>
  apiRequest<{ uploadId: string }>(`${V}/uploads`, { method: 'POST' }).then((r) => r.uploadId)

export const deleteUpload = (uploadId: string) =>
  apiRequest<void>(`${V}/uploads/${encodeURIComponent(uploadId)}`, { method: 'DELETE' })

function putFile(url: string, file: Blob, onProgress?: (sent: number) => void): Promise<number> {
  // XMLHttpRequest, not fetch: only it reports upload progress.
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    const token = localStorage.getItem(ACCESS_TOKEN_KEY)
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    xhr.upload.onprogress = (e) => onProgress?.(e.loaded)
    xhr.onload = () => (xhr.status < 300 ? resolve(xhr.status) : reject(new ApiError(xhr.status, xhr.responseText)))
    xhr.onerror = () => reject(new ApiError(0, 'Network error'))
    xhr.send(file)
  })
}

/** Send one ATHENA file (`CONCEPT.csv`…) into an upload; `onProgress` gets the bytes sent. */
export async function uploadFile(uploadId: string, file: File, onProgress?: (sent: number) => void): Promise<void> {
  const url = `${getApiBaseUrl()}/api/v1${V}/uploads/${encodeURIComponent(uploadId)}/files/${encodeURIComponent(file.name)}`
  try {
    await putFile(url, file, onProgress)
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error
    // An expired access token: any apiRequest refreshes it, then retry once.
    await getLibraryStatus()
    await putFile(url, file, onProgress)
  }
}

export const inspectExport = (source: ExportSource) =>
  apiRequest<InspectedExport>(`${V}/inspect`, { method: 'POST', body: JSON.stringify(source) })

/** `vocabularies` null = all of the export. */
export const startImport = (source: ExportSource, vocabularies: string[] | null) =>
  apiRequest<ImportJob>(`${V}/import`, { method: 'POST', body: JSON.stringify({ source, vocabularies }) })

export const getImportJob = (id: string) => apiRequest<ImportJob>(`${V}/jobs/${encodeURIComponent(id)}`)

export const removeVocabulary = (vocabularyId: string) =>
  apiRequest<void>(`${V}/vocabularies/${encodeURIComponent(vocabularyId)}`, { method: 'DELETE' })

export const removeLibrary = () => apiRequest<void>(V, { method: 'DELETE' })
