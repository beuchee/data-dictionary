import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { FilePen, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { draftEntityId } from '@/lib/drafts/paths'
import { useDraftsStore } from '@/stores/drafts-store'
import { ConfirmDialog } from './confirm-dialog'
import { draftHref, draftLabel } from './draft-content'
import type { Draft } from '@/lib/drafts/types'

/** Header button listing this user's pending drafts, to resume or discard them. Hidden when there are none. */
export function DraftsIndicator() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const drafts = useDraftsStore((s) => s.drafts)
  const load = useDraftsStore((s) => s.load)
  const discard = useDraftsStore((s) => s.discard)
  const [discarding, setDiscarding] = useState<Draft | null>(null)

  useEffect(() => {
    void load()
  }, [load])

  if (drafts.length === 0) return null

  const title = (draft: Draft) => {
    const label = draftLabel(draft, i18n.language)
    const id = draftEntityId(draft)
    const kind = t(`drafts.kind.${draft.kind}`)
    if (label) return label
    return id !== null ? `${kind} #${id}` : kind
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs" aria-label={t('drafts.indicator.label', { count: drafts.length })}>
            <FilePen size={14} />
            {t('drafts.indicator.button')}
            <Badge size="xs">{drafts.length}</Badge>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" density="compact" className="w-72">
          <DropdownMenuLabel>{t('drafts.indicator.title')}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {drafts.map((draft) => (
            <DropdownMenuItem key={draft.id} onClick={() => navigate(draftHref(draft))} className="group gap-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-foreground">{title(draft)}</span>
                <span className="block text-[10px] text-muted-foreground">
                  {t(`drafts.kind.${draft.kind}`)} · {new Date(draft.updatedAt).toLocaleString(i18n.language)}
                </span>
              </span>
              <button
                type="button"
                className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                aria-label={t('drafts.indicator.discard')}
                onClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  setDiscarding(draft)
                }}
              >
                <Trash2 size={12} />
              </button>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={discarding !== null}
        onOpenChange={(open) => !open && setDiscarding(null)}
        title={t('drafts.discard.title')}
        description={discarding ? t('drafts.discard.description', { name: title(discarding) }) : undefined}
        confirmLabel={t('drafts.discard.confirm')}
        onConfirm={() => {
          if (discarding) discard(discarding.id).catch((e) => console.error('Could not discard the draft', e))
          setDiscarding(null)
        }}
      />
    </>
  )
}
