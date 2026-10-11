import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckSquare, Download, GitPullRequest, Loader2, Pencil, Plus, Save, Square, Trash2, Undo2, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { isServerMode } from '@/lib/api-client'
import { forgeName, repositoryConfig } from '@/lib/data/forge'
import { downloadText } from '@/lib/export/download'
import { useInstanceConfig } from '@/stores/config-store'
import { useDraftsStore } from '@/stores/drafts-store'
import { ConfirmDialog } from '@/features/drafts/confirm-dialog'
import { SubmitDialog } from '@/features/drafts/submit-dialog'
import { CopyExportButton } from '@/features/export/copy-export-button'
import { UNITS_FILE_NAME, exportUnitsFile, type UnitsKind } from './unit-rows'
import type { UnitsEditor } from './use-units-editor'

interface UnitsToolbarProps<K extends UnitsKind> {
  kind: K
  editor: UnitsEditor<K>
  /** Indices of the selected rows (edit mode). */
  selected: ReadonlySet<number>
  onSelectAll: () => void
  onUnselectAll: () => void
  onDeleteSelected: () => void
  onAdd: () => void
  addLabel: string
  /** Leaves edit mode (asking first when there are unsaved edits). */
  onCancel: () => void
}

/** v1's two toolbars: read mode (draft actions, export, edit) and selection mode. */
export function UnitsToolbar<K extends UnitsKind>({
  kind,
  editor,
  selected,
  onSelectAll,
  onUnselectAll,
  onDeleteSelected,
  onAdd,
  addLabel,
  onCancel,
}: UnitsToolbarProps<K>) {
  const { t } = useTranslation()
  const config = useInstanceConfig()
  const discard = useDraftsStore((s) => s.discard)
  const [submitOpen, setSubmitOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const { draft } = editor

  if (editor.editing) {
    return (
      <div className="mb-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={onAdd}>
            <Plus size={14} />
            {addLabel}
          </Button>
          <Button size="sm" variant="outline" onClick={onSelectAll}>
            <CheckSquare size={14} />
            {t('units.select_all')}
          </Button>
          <Button size="sm" variant="outline" onClick={onUnselectAll} disabled={selected.size === 0}>
            <Square size={14} />
            {t('units.unselect_all')}
          </Button>
          <Button size="sm" variant="outline" onClick={onDeleteSelected} disabled={selected.size === 0}>
            <Trash2 size={14} />
            {t('units.delete_selected')}
          </Button>
          <span className="text-xs text-muted-foreground">{t('units.selected_count', { count: selected.size })}</span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="ghost" onClick={onCancel} disabled={editor.saving}>
              <X size={14} />
              {t('common.cancel')}
            </Button>
            <Button size="sm" onClick={() => void editor.save()} disabled={editor.saving}>
              {editor.saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {t('units.save')}
            </Button>
          </div>
        </div>
        {editor.saveError && <NoticeBanner tone="danger" title={t('drafts.save_failed')} description={editor.saveError} />}
      </div>
    )
  }

  return (
    <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
      {draft && (
        <>
          <Badge variant="outline" className="mr-auto border-primary/50 text-primary">
            {isServerMode() ? t('drafts.badge_server') : t('drafts.badge')}
          </Badge>
          <Button size="sm" variant="outline" onClick={() => setDiscardOpen(true)}>
            <Undo2 size={14} />
            {t('drafts.discard_button')}
          </Button>
          <Button size="sm" onClick={() => setSubmitOpen(true)}>
            <GitPullRequest size={14} />
            {isServerMode() ? t('drafts.submit_button') : t('drafts.propose_button', { forge: forgeName(repositoryConfig(config)) })}
          </Button>
        </>
      )}
      <Button size="sm" variant="outline" onClick={() => setExportOpen(true)} disabled={editor.status !== 'ready'}>
        <Download size={14} />
        {t('units.export')}
      </Button>
      {editor.mayEdit && (
        <Button size="sm" variant={draft ? 'outline' : 'default'} onClick={editor.enterEdit} disabled={editor.status !== 'ready'}>
          <Pencil size={14} />
          {t('units.edit')}
        </Button>
      )}
      <SubmitDialog open={submitOpen} onOpenChange={setSubmitOpen} draft={draft ?? null} onSubmitted={editor.reload} />
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={t('drafts.discard.title')}
        description={t('drafts.discard.description', { name: t(`drafts.kind.${kind}`) })}
        confirmLabel={t('drafts.discard.confirm')}
        onConfirm={() => {
          setDiscardOpen(false)
          if (draft) discard(draft.id).catch((e) => console.error('Could not discard the draft', e))
        }}
      />
      <ExportUnitsDialog open={exportOpen} onOpenChange={setExportOpen} kind={kind} rows={editor.rows} />
    </div>
  )
}

interface ExportUnitsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: UnitsKind
  rows: readonly unknown[]
}

/** v1's export modal: the file as the repository holds it, copied or downloaded. */
function ExportUnitsDialog({ open, onOpenChange, kind, rows }: ExportUnitsDialogProps) {
  const { t } = useTranslation()
  const filename = UNITS_FILE_NAME[kind]
  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={t('units.export_title')}
      description={t('units.export_description', { count: rows.length, file: filename })}
    >
      <div className="flex flex-wrap items-center gap-2">
        <CopyExportButton getText={() => exportUnitsFile(rows, kind)} />
        <Button
          variant="outline"
          size="sm"
          onClick={() => downloadText(filename, exportUnitsFile(rows, kind), 'application/json')}
        >
          <Download size={14} />
          {t('units.download', { file: filename })}
        </Button>
      </div>
    </DialogShell>
  )
}
