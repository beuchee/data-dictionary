// Parity with legacy/settings.js (Unit conversions tab).
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Calculator, Loader2, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DataTable, type DataTableColumn } from '@/components/ui/data-table'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { toNumber, type UnitConversion } from '@data-dictionary/format'
import { ConfirmDialog } from '@/features/drafts/confirm-dialog'
import { useUnsavedChangesGuard } from '@/features/drafts/unsaved-changes'
import { ConversionDialog, InlineNumberCell, TestConversionDialog } from './unit-dialogs'
import { numberText, removeRows, setConversionFactor, upsertRow } from './unit-rows'
import { UnitsToolbar } from './units-toolbar'
import { useUnitsEditor } from './use-units-editor'
import { useRowSelection } from './use-row-selection'

interface Row {
  row: UnitConversion
  index: number
}

export function UnitConversionsTab() {
  const { t } = useTranslation()
  const editor = useUnitsEditor('unit-conversions')
  const { selected, toggle, selectAll, clear } = useRowSelection(editor.editing)
  const [dialog, setDialog] = useState<{ index: number | null } | null>(null)
  const [testRow, setTestRow] = useState<UnitConversion | null>(null)
  const [pendingDelete, setPendingDelete] = useState<number[] | null>(null)
  const { confirmIfDirty, dialog: unsavedDialog } = useUnsavedChangesGuard(editor.dirty, editor.cancelEdit)
  const data = useMemo<Row[]>(() => editor.rows.map((row, index) => ({ row, index })), [editor.rows])

  const columns: DataTableColumn<Row>[] = [
    ...(editor.editing
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
            cell: (r: Row) => (
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
            cell: (r: Row) => (
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
          } satisfies DataTableColumn<Row>,
        ]
      : []),
    { id: 'conceptId', header: t('units.col.concept_id'), accessor: (r) => r.row.conceptId, filter: 'text', size: 100, align: 'right' },
    { id: 'conceptName', header: t('units.col.concept_name'), accessor: (r) => r.row.conceptName, filter: 'text', size: 320 },
    {
      id: 'source',
      header: t('units.col.source_unit'),
      accessor: (r) => r.row.sourceUnitCode || r.row.sourceUnitName,
      display: (r) => `${r.row.sourceUnitCode}${r.row.sourceUnitName ? ` (${r.row.sourceUnitName})` : ''}`,
      filter: 'text',
      size: 170,
    },
    {
      id: 'factor',
      header: t('units.col.factor'),
      accessor: (r) => toNumber(r.row.conversionFactor),
      cell: (r) => {
        const text = (
          <span className="font-mono">
            {numberText(r.row.conversionFactor)}
            {r.row.offset !== undefined && toNumber(r.row.offset) !== 0 && (
              <span className="ml-1 text-muted-foreground" title={t('units.conversions.offset_hint')}>
                {toNumber(r.row.offset) > 0 ? '+ ' : '− '}
                {numberText(r.row.offset).replace(/^-/, '')}
              </span>
            )}
          </span>
        )
        if (!editor.editing) return text
        return (
          <InlineNumberCell
            value={r.row.conversionFactor}
            display={text}
            label={t('units.col.factor')}
            onCommit={(value) => {
              const next = setConversionFactor(editor.rows, r.index, value)
              if (next === null) return false
              if (next !== editor.rows) editor.setRows(next)
              return true
            }}
          />
        )
      },
      filter: 'number',
      size: 130,
      align: 'right',
    },
    {
      id: 'target',
      header: t('units.col.target_unit'),
      accessor: (r) => r.row.targetUnitCode || r.row.targetUnitName,
      display: (r) => `${r.row.targetUnitCode}${r.row.targetUnitName ? ` (${r.row.targetUnitName})` : ''}`,
      filter: 'text',
      size: 170,
    },
    {
      id: 'test',
      header: t('units.test.column'),
      headerCell: () => null,
      accessor: () => null,
      cell: (r) => (
        <Button variant="ghost" size="xs" onClick={() => setTestRow(r.row)}>
          <Calculator size={12} />
          {t('units.test.button')}
        </Button>
      ),
      size: 80,
    },
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
      <p className="mb-3 text-xs text-muted-foreground">{t('units.conversions.description')}</p>
      <UnitsToolbar
        kind="unit-conversions"
        editor={editor}
        selected={selected}
        onSelectAll={() => selectAll(data.length)}
        onUnselectAll={clear}
        onDeleteSelected={() => setPendingDelete([...selected])}
        onAdd={() => setDialog({ index: null })}
        addLabel={t('units.conversions.new')}
        onCancel={() => confirmIfDirty(editor.cancelEdit)}
      />
      <DataTable
        data={data}
        columns={columns}
        rowKey={(r) => r.index}
        pageSize={100}
        emptyMessage={t('units.conversions.empty')}
        cellTooltips="all"
        rowClassName={(r) => (selected.has(r.index) ? 'bg-primary/5' : undefined)}
      />
      <ConversionDialog
        open={dialog !== null}
        onOpenChange={(open) => !open && setDialog(null)}
        rows={editor.rows}
        editIndex={dialog?.index ?? null}
        onSubmit={(row, index) => editor.setRows(upsertRow(editor.rows, row, index))}
      />
      <TestConversionDialog row={testRow} onOpenChange={(open) => !open && setTestRow(null)} />
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={t('units.delete_title')}
        description={t('units.conversions.delete_confirm', { count: pendingDelete?.length ?? 0 })}
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
