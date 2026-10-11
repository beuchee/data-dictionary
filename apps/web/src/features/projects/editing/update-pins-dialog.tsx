import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { DialogShell } from '@/components/ui/dialog-shell'
import { resolvedKey, useCatalogStore } from '@/stores/catalog-store'
import { diffResolved, type ResolvedDiff } from '../lib/project-editing'
import type { ResolvedConcept } from '@data-dictionary/format'

export interface PinUpdate {
  id: number
  name: string | null
  pinned: string
  current: string
}

interface UpdatePinsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The pins to move to the current version (one for "Update", all outdated for "Update all"). */
  updates: readonly PinUpdate[]
  onConfirm: () => void
  busy?: boolean
}

type DiffState = { status: 'loading' } | { status: 'ready'; diff: ResolvedDiff | null }

/**
 * Moving pinned concept sets to their current version, showing for each the
 * concepts its resolved list gains (+) and loses (−) between the two versions
 * (v1's update modal). A diff that can't be computed says so rather than
 * reading as "everything changed".
 */
export function UpdatePinsDialog({ open, onOpenChange, updates, onConfirm, busy }: UpdatePinsDialogProps) {
  const { t } = useTranslation()
  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      kind="workbench"
      title={t('projects.update.title', { count: updates.length })}
      description={t('projects.update.description')}
      onConfirm={onConfirm}
      confirmLabel={t('projects.update.confirm', { count: updates.length })}
      busy={busy}
    >
      <div className="space-y-4">{open && updates.map((u) => <PinDiff key={u.id} update={u} />)}</div>
    </DialogShell>
  )
}

function PinDiff({ update }: { update: PinUpdate }) {
  const { t } = useTranslation()
  const loadResolved = useCatalogStore((s) => s.loadResolved)
  const [state, setState] = useState<DiffState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    const read = async (version: string | undefined): Promise<ResolvedConcept[] | null> => {
      const query = { version }
      await loadResolved(update.id, query)
      return useCatalogStore.getState().resolved[resolvedKey(update.id, query)]?.data?.resolvedConcepts ?? null
    }
    Promise.all([read(update.pinned), read(undefined)])
      .then(([before, after]) => !cancelled && setState({ status: 'ready', diff: diffResolved(before, after) }))
      .catch(() => !cancelled && setState({ status: 'ready', diff: null }))
    return () => {
      cancelled = true
    }
  }, [update.id, update.pinned, loadResolved])

  return (
    <section className="rounded-md border p-3">
      <h3 className="text-sm font-medium">
        {update.name || `#${update.id}`}{' '}
        <span className="font-mono text-xs text-muted-foreground">
          {update.pinned} → {update.current}
        </span>
      </h3>
      {state.status === 'loading' ? (
        <Loader2 size={14} className="mt-2 animate-spin text-muted-foreground" />
      ) : !state.diff ? (
        <p className="mt-1 text-xs italic text-muted-foreground">{t('projects.update.diff_unavailable')}</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('projects.update.summary', { before: state.diff.oldCount, after: state.diff.newCount })} ·{' '}
            <span className="text-emerald-700 dark:text-emerald-400">+{state.diff.added.length}</span> ·{' '}
            <span className="text-destructive">−{state.diff.removed.length}</span>
          </p>
          {state.diff.added.length === 0 && state.diff.removed.length === 0 ? (
            <p className="mt-1 text-xs italic text-muted-foreground">{t('projects.update.no_change')}</p>
          ) : (
            <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto font-mono text-xs">
              {state.diff.added.map((c) => (
                <li key={`+${c.conceptId}`} className="text-emerald-700 dark:text-emerald-400">
                  + {c.conceptId} {c.conceptName} <span className="text-muted-foreground">({c.vocabularyId} {c.conceptCode})</span>
                </li>
              ))}
              {state.diff.removed.map((c) => (
                <li key={`-${c.conceptId}`} className="text-destructive">
                  − {c.conceptId} {c.conceptName} <span className="text-muted-foreground">({c.vocabularyId} {c.conceptCode})</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
