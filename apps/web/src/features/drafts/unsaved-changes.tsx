import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { ConfirmDialog } from './confirm-dialog'

/**
 * Guards unsaved edits: closing or reloading the tab asks the browser's own
 * question, an in-app link click (sidebar, breadcrumb…) and any action passed
 * through `confirmIfDirty` ask ours. The app uses a `BrowserRouter`, which has
 * no navigation blocker, so links are caught in the capture phase.
 */
export function useUnsavedChangesGuard(dirty: boolean, onDiscard?: () => void) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [pending, setPending] = useState<(() => void) | null>(null)
  const dirtyRef = useRef(dirty)
  const discardRef = useRef(onDiscard)
  useEffect(() => {
    dirtyRef.current = dirty
    discardRef.current = onDiscard
  })

  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    const onClick = (e: MouseEvent) => {
      if (!dirtyRef.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const anchor = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return
      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin) return
      const base = import.meta.env.BASE_URL.replace(/\/$/, '')
      const to = url.pathname.slice(base.length) + url.search + url.hash
      if (to === window.location.pathname.slice(base.length) + window.location.search) return
      e.preventDefault()
      e.stopPropagation()
      setPending(() => () => navigate(to))
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [dirty, navigate])

  /** Runs `action` now, or after the user agreed to lose the edits. */
  const confirmIfDirty = useCallback((action: () => void) => {
    if (!dirtyRef.current) action()
    else setPending(() => action)
  }, [])

  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(open) => !open && setPending(null)}
      title={t('drafts.unsaved.title')}
      description={t('drafts.unsaved.description')}
      confirmLabel={t('drafts.unsaved.discard')}
      onConfirm={() => {
        const action = pending
        setPending(null)
        discardRef.current?.()
        action?.()
      }}
    />
  )

  return { confirmIfDirty, dialog }
}
