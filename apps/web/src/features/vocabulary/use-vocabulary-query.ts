import { useEffect, useState } from 'react'
import { VocabularyUnavailableError } from '@/lib/vocabulary'

export type VocabularyQueryState<T> =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'unavailable' }
  | { status: 'error' }

/**
 * Run `load` against the vocabulary when `key` changes (null: do nothing),
 * dropping answers that arrive after the key moved on.
 */
export function useVocabularyQuery<T>(key: string | null, load: () => Promise<T>): VocabularyQueryState<T> {
  const [state, setState] = useState<{ key: string | null; value: VocabularyQueryState<T> }>({
    key: null,
    value: { status: 'idle' },
  })

  useEffect(() => {
    if (key === null) return
    let cancelled = false
    // No 'loading' set here: a key the state does not hold yet reads as loading below.
    load()
      .then((data) => !cancelled && setState({ key, value: { status: 'ready', data } }))
      .catch((error) => {
        if (cancelled) return
        if (error instanceof VocabularyUnavailableError) {
          setState({ key, value: { status: 'unavailable' } })
          return
        }
        console.error('Vocabulary query failed:', error)
        setState({ key, value: { status: 'error' } })
      })
    return () => {
      cancelled = true
    }
    // `load` is a fresh closure each render; `key` says when it asks for something else.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (key === null) return { status: 'idle' }
  return state.key === key ? state.value : { status: 'loading' }
}
