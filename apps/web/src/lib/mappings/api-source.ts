import { ApiError, apiRequest } from '@/lib/api-client'
import { ERROR_CODES, MappingImportError, type MappingImportErrorCode } from '@/lib/mapping-import/types'
import type { MappingImportDetail, MappingImportSummary, MappingSource, NewMappingImport } from './types'

/** A 422 from `POST /mappings` carries the parser's `{code, detail}`: rethrow it as the browser parser would. */
export function importErrorFrom(error: unknown): unknown {
  if (!(error instanceof ApiError) || error.status !== 422) return error
  try {
    const detail = (JSON.parse(error.message) as { detail?: { code?: string; detail?: string | null } }).detail
    if (detail?.code && (ERROR_CODES as readonly string[]).includes(detail.code)) {
      return new MappingImportError(detail.code as MappingImportErrorCode, detail.detail ?? null)
    }
  } catch {
    // not the parser's error shape
  }
  return error
}

/** Server mode: `/api/v1/mappings` (apps/api/app/api/v1/routes/mappings.py). */
export class ApiMappingSource implements MappingSource {
  readonly kind = 'api' as const

  list(): Promise<MappingImportSummary[]> {
    return apiRequest('/mappings')
  }

  async get(id: string): Promise<MappingImportDetail | null> {
    try {
      return await apiRequest(`/mappings/${encodeURIComponent(id)}`)
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null
      throw error
    }
  }

  async create(input: NewMappingImport): Promise<MappingImportSummary> {
    const form = new FormData()
    for (const f of input.files) form.append('files', new Blob([f.data as BlobPart]), f.name)
    form.append('options', JSON.stringify(input.options))
    form.append('name', input.name)
    form.append('description', input.description)
    try {
      return await apiRequest('/mappings', { method: 'POST', body: form })
    } catch (error) {
      throw importErrorFrom(error)
    }
  }

  remove(id: string): Promise<void> {
    return apiRequest(`/mappings/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }
}
