import { isServerMode } from '@/lib/api-client'
import { ApiVocabularySource } from './api-source'
import { WasmVocabularySource } from './wasm-source'
import type { VocabularySource } from './types'

export type * from './types'
export { VocabularyUnavailableError } from './types'

let source: VocabularySource | null = null

/** The OMOP vocabulary for this build: the API in server mode, DuckDB-WASM in static mode. */
export function getVocabularySource(): VocabularySource {
  source ??= isServerMode() ? new ApiVocabularySource() : new WasmVocabularySource()
  return source
}

/** Replace the source (tests). */
export function setVocabularySource(next: VocabularySource | null): void {
  source = next
}
