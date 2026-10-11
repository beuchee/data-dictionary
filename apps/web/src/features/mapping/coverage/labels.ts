import type { TFunction } from 'i18next'
import { ApiError } from '@/lib/api-client'
import { MappingImportError } from '@/lib/mapping-import/types'

/** A parser or upload failure, in the UI language. */
export function importErrorMessage(t: TFunction, error: unknown): string {
  if (error instanceof MappingImportError) {
    return t(`coverage.errors.${error.code}`, { detail: error.detail ?? '' })
  }
  if (error instanceof ApiError) {
    if (error.status === 413) return t('coverage.errors.too_large')
    if (error.status === 403) return t('coverage.errors.forbidden')
  }
  return t('coverage.errors.unknown', { message: error instanceof Error ? error.message : String(error) })
}
