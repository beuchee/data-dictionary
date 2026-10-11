// Parity with legacy/settings.js (Recommended units tab).
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DataTable, type DataTableColumn } from '@/components/ui/data-table'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { ConfirmDialog } from '@/features/drafts/confirm-dialog'
import { useUnsavedChangesGuard } from '@/features/drafts/unsaved-changes'
import { RecommendedUnitDialog } from './unit-dialogs'
import { removeRows, upsertRow } from './unit-rows'
import { UnitsToolbar } from './units-toolbar'
import { useRowSelection } from './use-row-selection'
import { useUnitsEditor } from './use-units-editor'
import type { RecommendedUnit } from '@data-dictionary/format'

interface Row {
  row: RecommendedUnit
  index: number
}

export function RecommendedUnitsTab() {
  const { t } = useTranslation()
  const editor = useUnitsEditor('recommended-units')
  const { selected, toggle, selectAll, clear } = useRowSelection(editor.editing)
  const [dialog, setDialog] = useState<{ index: number | null } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<number[] | null>(null)
  const { confirmIfDirty, dialog: unsavedDialog } = useUnsavedChangesGuard(editor.dirty, editor.cancelEdit)
  const data = useMemo<Row[]>(() => editor.rows.map((row, index) => ({ row, index })), [editor.rows])

  const editColumns: DataTableColumn<Row>[] = editor.editing
    ? [
        {
          id: 'select',
          header: t('units.select'),
          headerCell: () => (
            <Checkbox
              checked={data.length > 0 && selected.size === data.length}
              onCheckedChange={(on) => (on ? selectAll(data.length) : clear())}
              aria-label={t('units.select_all')}
            />
          ),
          accessor: () => null,
          cell: (r) => (
            <Checkbox
              checked={selected.has(r.index)}
              onCheckedChange={() => toggle(r.index)}
              onClick={(e) => e.stopPropagation()}
              aria-label={t('units.select_row')}
            />
          ),
          size: 36,
        },
        {
          id: 'actions',
          header: t('units.actions'),
          headerCell: () => null,
          accessor: () => null,
          cell: (r) => (
            <div className="flex gap-0.5">
              <Button variant="ghost" size="icon-xs" aria-label={t('units.edit_row')} onClick={() => setDialog({ index: r.index })}>
                <Pencil size={12} />
              </Button>
              <Button variant="ghost" size="icon-xs" aria-label={t('units.delete_row')} onClick={() => setPendingDelete([r.index])}>
                <Trash2 size={12} />
              </Button>
            </div>
          ),
          size: 64,
        },
      ]
    : []

  const columns: DataTableColumn<Row>[] = [
    ...editColumns,
    { id: 'conceptId', header: t('units.col.concept_id'), accessor: (r) => r.row.conceptId, filter: 'text', size: 100, align: 'right' },
    { id: 'conceptName', header: t('units.col.concept_name'), accessor: (r) => r.row.conceptName, filter: 'text', size: 360 },
    { id: 'conceptCode', header: t('units.col.code'), accessor: (r) => r.row.conceptCode, filter: 'text', size: 100, hidden: true },
    { id: 'vocabularyId', header: t('units.col.vocabulary'), accessor: (r) => r.row.vocabularyId, filter: 'select', size: 100, hidden: true },
    { id: 'unitName', header: t('units.col.unit_name'), accessor: (r) => r.row.recommendedUnitName, filter: 'text', size: 220 },
    { id: 'unitCode', header: t('units.col.unit_code'), accessor: (r) => r.row.recommendedUnitCode, filter: 'text', size: 120 },
  ]

  if (editor.status === 'loading') {
    return (
      <div className="flex justify-center py-12">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (editor.status === 'error') return <NoticeBanner tone="danger" title={t('units.load_error')} description={editor.error} />

  return (
    <div>
      <p className="mb-3 text-xs text-muted-foreground">{t('units.recommended.description')}</p>
      <UnitsToolbar
        kind="recommended-units"
        editor={editor}
        selected={selected}
        onSelectAll={() => selectAll(data.length)}
        onUnselectAll={clear}
        onDeleteSelected={() => setPendingDelete([...selected])}
        onAdd={() => setDialog({ index: null })}
        addLabel={t('units.recommended.new')}
        onCancel={() => confirmIfDirty(editor.cancelEdit)}
      />
      <DataTable
        data={data}
        columns={columns}
        rowKey={(r) => r.index}
        pageSize={100}
        emptyMessage={t('units.recommended.empty')}
        cellTooltips="all"
        rowClassName={(r) => (selected.has(r.index) ? 'bg-primary/5' : undefined)}
      />
      <RecommendedUnitDialog
        open={dialog !== null}
        onOpenChange={(open) => !open && setDialog(null)}
        rows={editor.rows}
        editIndex={dialog?.index ?? null}
        onSubmit={(row, index) => editor.setRows(upsertRow(editor.rows, row, index))}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={t('units.delete_title')}
        description={t('units.recommended.delete_confirm', { count: pendingDelete?.length ?? 0 })}
        confirmLabel={t('units.delete')}
        onConfirm={() => {
          if (pendingDelete) editor.setRows(removeRows(editor.rows, pendingDelete))
          setPendingDelete(null)
          clear()
        }}
      />
      {unsavedDialog}
    </div>
  )
}
