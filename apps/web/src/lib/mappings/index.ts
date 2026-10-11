import { isServerMode } from '@/lib/api-client'
import { ApiMappingSource } from './api-source'
import { LocalMappingSource } from './local-source'
import type { MappingSource } from './types'

export type * from './types'

let source: MappingSource | null = null

/** Imported mappings for this build: the API in server mode, IndexedDB in static mode. */
export function getMappingSource(): MappingSource {
  source ??= isServerMode() ? new ApiMappingSource() : new LocalMappingSource()
  return source
}

/** Replace the source (tests). */
export function setMappingSource(next: MappingSource | null): void {
  source = next
}
