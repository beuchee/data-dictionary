import { useCallback, useEffect, useState } from 'react'
import { contentEqual } from '@/lib/drafts/diff'
import { findDraft } from '@/lib/drafts/overlay'
import { canEdit } from '@/lib/drafts/permissions'
import { userHasPermission, useAuthStore } from '@/stores/auth-store'
import { useDraftsStore } from '@/stores/drafts-store'
import { loadUnitsFile, type UnitsFileByKind } from './units-source'
import type { Draft } from '@/lib/drafts/types'
import type { UnitsKind } from './unit-rows'

type BaseState<K extends UnitsKind> =
  | { status: 'loading' }
  | { status: 'ready'; rows: UnitsFileByKind[K] }
  | { status: 'error'; error: string }

export interface UnitsEditor<K extends UnitsKind> {
  status: 'loading' | 'ready' | 'error'
  error: string | null
  /** What the table shows: the working copy in edit mode, else the draft, else the repository's. */
  rows: UnitsFileByKind[K]
  draft: Draft | undefined
  mayEdit: boolean
  editing: boolean
  dirty: boolean
  saving: boolean
  saveError: string | null
  enterEdit: () => void
  cancelEdit: () => void
  /** Saves the working copy as this user's draft of the file (nothing when unchanged). */
  save: () => Promise<void>
  setRows: (rows: UnitsFileByKind[K]) => void
  /** After a submit: the repository's file may have changed. */
  reload: () => void
}

/**
 * The edit cycle of a units file (v1's selection mode): Edit takes a working
 * copy of what is shown, Cancel drops it, Save stores it as a `unit-conversions`
 * / `recommended-units` draft, submitted through the SubmitDialog.
 */
export function useUnitsEditor<K extends UnitsKind>(kind: K): UnitsEditor<K> {
  const user = useAuthStore((s) => s.user)
  const drafts = useDraftsStore((s) => s.drafts)
  const loadDrafts = useDraftsStore((s) => s.load)
  const saveDraft = useDraftsStore((s) => s.save)
  const [base, setBase] = useState<BaseState<K>>({ status: 'loading' })
  const [generation, setGeneration] = useState(0)
  const [working, setWorking] = useState<UnitsFileByKind[K] | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const draft: Draft | undefined = findDraft(drafts, kind, null)
  const mayEdit = canEdit(kind, (p) => userHasPermission(user, p))

  useEffect(() => {
    void loadDrafts()
  }, [loadDrafts])

  useEffect(() => {
    let cancelled = false
    loadUnitsFile(kind)
      .then((rows) => !cancelled && setBase({ status: 'ready', rows }))
      .catch((e) => {
        console.error(`Could not load ${kind}`, e)
        if (!cancelled) setBase({ status: 'error', error: e instanceof Error ? e.message : String(e) })
      })
    return () => {
      cancelled = true
    }
  }, [kind, generation])

  const baseRows = base.status === 'ready' ? base.rows : ([] as unknown as UnitsFileByKind[K])
  // A units draft's content is that file's rows.
  const shown = (draft?.content as unknown as UnitsFileByKind[K] | undefined) ?? baseRows
  const rows = working ?? shown
  const dirty = working !== null && !contentEqual(shown, working)

  const save = useCallback(async () => {
    if (working === null) return
    setSaving(true)
    setSaveError(null)
    try {
      if (!contentEqual(shown, working)) {
        await saveDraft({ kind, targetId: null, content: working } as Parameters<typeof saveDraft>[0])
      }
      setWorking(null)
    } catch (e) {
      console.error(`Could not save the ${kind} draft`, e)
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }, [kind, saveDraft, shown, working])

  return {
    status: draft ? 'ready' : base.status,
    error: base.status === 'error' ? base.error : null,
    rows,
    draft,
    mayEdit,
    editing: working !== null,
    dirty,
    saving,
    saveError,
    enterEdit: () => {
      setSaveError(null)
      setWorking(shown)
    },
    cancelEdit: () => setWorking(null),
    save,
    setRows: (next) => setWorking(next),
    reload: () => setGeneration((g) => g + 1),
  }
}
