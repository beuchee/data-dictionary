import { useCallback, useEffect, useState } from 'react'
import { isServerMode } from '@/lib/api-client'
import { getVocabularySource, type VocabularyInfo } from '@/lib/vocabulary'
import { getLibraryStatus, type LibraryStatus } from '@/lib/vocabulary/api-admin'
import type { StoredVocabularyMeta } from '@/lib/vocabulary/wasm/persist'
import { useHasPermission } from '@/stores/auth-store'

/** What the Vocabularies tab shows, by mode and permission. */
export type VocabularyView =
  | { kind: 'server-admin'; status: LibraryStatus }
  | { kind: 'server-reader'; info: VocabularyInfo }
  | { kind: 'browser'; info: VocabularyInfo; meta: StoredVocabularyMeta | null }

async function load(canManage: boolean): Promise<VocabularyView> {
  if (isServerMode()) {
    if (canManage) return { kind: 'server-admin', status: await getLibraryStatus() }
    return { kind: 'server-reader', info: await getVocabularySource().getInfo() }
  }
  const info = await getVocabularySource().getInfo()
  const { storedMeta } = await import('@/lib/vocabulary/wasm/library')
  return { kind: 'browser', info, meta: await storedMeta() }
}

export function useVocabularyView() {
  const canManage = useHasPermission('settings:manage')
  const [view, setView] = useState<VocabularyView | null>(null)
  const [error, setError] = useState(false)
  const [version, setVersion] = useState(0)

  const reload = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    let cancelled = false
    load(canManage)
      .then((next) => {
        if (cancelled) return
        setView(next)
        setError(false)
      })
      .catch((e) => {
        if (cancelled) return
        console.error('Could not read the vocabulary status:', e)
        setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [canManage, version])

  // Static mode: an import or a removal elsewhere in the app refreshes the tab.
  useEffect(() => {
    if (isServerMode()) return
    let unsubscribe: (() => void) | undefined
    let cancelled = false
    void import('@/lib/vocabulary/wasm/library').then((m) => {
      if (!cancelled) unsubscribe = m.onVocabularyChange(reload)
    })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [reload])

  return { view, error, reload, canManage }
}
