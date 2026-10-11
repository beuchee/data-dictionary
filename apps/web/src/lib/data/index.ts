import { isServerMode } from '@/lib/api-client'
import { ApiSource } from './api-source'
import { StaticSource } from './static-source'
import type { DictionarySource } from './types'

export type * from './types'

let source: DictionarySource | null = null

/** The content source for this build: the API in server mode, the static payload otherwise. */
export function getDictionarySource(): DictionarySource {
  source ??= isServerMode() ? new ApiSource() : new StaticSource()
  return source
}

/** Replace the source (tests, or a future "preview another repo" mode). */
export function setDictionarySource(next: DictionarySource | null): void {
  source = next
}
