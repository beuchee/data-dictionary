// Ported from legacy/concept-sets.js (renderExpressionTable in edit mode,
// exprSelectAll / deleteExprSelected / deleteExprRow, the flag checkboxes, the
// edit-custom-concept button, the toolbar's Add / Import / Optimize).
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileJson, Layers, Pencil, Plus, Trash2, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DataTable, type DataTableColumn } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { Switch } from '@/components/ui/switch'
import { ConfirmDialog } from '@/features/drafts/confirm-dialog'
import { isValidConcept, standardKind } from '../lib/concept-links'
import { isCustomId, removeItems, setItemFlag, type ItemFlag } from '../lib/expression'
import { StandardBadge, ValidityBadge } from '../components/badges'
import { AddConceptsDialog } from './add-concepts-dialog'
import { CustomConceptDialog } from './custom-concept-dialog'
import { ImportAtlasDialog } from './import-atlas-dialog'
import { OptimizeDialog } from './optimize-dialog'
import type { ConceptInfo } from '../components/concept-detail-sheet'
import type { ExpressionItem } from '@data-dictionary/format'

interface ExpressionEditorProps {
  conceptSetId: number
  items: ExpressionItem[]
  onChange: (items: ExpressionItem[]) => void
  onSelect: (concept: ConceptInfo) => void
}

interface Row {
  index: number
  item: ExpressionItem
}

const FLAG_LABEL: Record<ItemFlag, string> = {
  isExcluded: 'concept_sets.concepts.exclude',
  includeDescendants: 'concept_sets.concepts.descendants',
  includeMapped: 'concept_sets.concepts.mapped',
}

/**
 * The Concepts tab's expression in edit mode: per-row exclude / descendants /
 * mapped switches, multi-select delete, a custom concept's edit button, and
 * the dialogs that add (vocabulary search, custom concept), import (ATLAS
 * JSON) and optimize items. Every change goes to `onChange` (the editor store).
 */
export function ExpressionEditor({ conceptSetId, items, onChange, onSelect }: ExpressionEditorProps) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<Set<string | number>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState<number[] | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [optimizeOpen, setOptimizeOpen] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)

  const rows = useMemo(() => items.map((item, index) => ({ index, item })), [items])
  const change = (next: ExpressionItem[]) => {
    setSelected(new Set())
    onChange(next)
  }
  const standardLabel = (s: string | null | undefined) => t(`concept_sets.standard.${standardKind(s)}`)
  const yes = t('concept_sets.concepts.yes')

  const flagColumn = (flag: ItemFlag, size: number): DataTableColumn<Row> => ({
    id: flag,
    header: t(FLAG_LABEL[flag]),
    accessor: (r) => (r.item[flag] ? yes : ''),
    size,
    align: 'center',
    cell: (r) => (
      // A click on the switch must not open the concept's sheet.
      <span onClick={(e) => e.stopPropagation()} className="inline-flex">
        <Switch
          size="sm"
          checked={!!r.item[flag]}
          aria-label={`${t(FLAG_LABEL[flag])}: ${r.item.concept.conceptName}`}
          onCheckedChange={(on) => onChange(setItemFlag(items, r.index, flag, on))}
        />
      </span>
    ),
  })

  const columns: DataTableColumn<Row>[] = [
    { id: 'vocabulary', header: t('concept_sets.concept.vocabulary'), accessor: (r) => r.item.concept.vocabularyId, filter: 'select', size: 110 },
    { id: 'conceptId', header: t('concept_sets.concept.id'), accessor: (r) => r.item.concept.conceptId, filter: 'number', size: 110, align: 'right' },
    { id: 'name', header: t('concept_sets.concept.name'), accessor: (r) => r.item.concept.conceptName, filter: 'text', size: 280 },
    { id: 'code', header: t('concept_sets.concept.code'), accessor: (r) => r.item.concept.conceptCode, filter: 'text', size: 110 },
    { id: 'domain', header: t('concept_sets.concept.domain'), accessor: (r) => r.item.concept.domainId, filter: 'select', size: 110, hidden: true },
    {
      id: 'standard',
      header: t('concept_sets.concept.standard'),
      accessor: (r) => standardLabel(r.item.concept.standardConcept),
      filter: 'select',
      size: 115,
      align: 'center',
      cell: (r) => <StandardBadge standardConcept={r.item.concept.standardConcept} />,
    },
    {
      id: 'validity',
      header: t('concept_sets.concept.validity'),
      accessor: (r) => (isValidConcept(r.item.concept.invalidReason) ? t('concept_sets.concept.valid') : t('concept_sets.concept.invalid')),
      filter: 'select',
      size: 100,
      align: 'center',
      hidden: true,
      cell: (r) => <ValidityBadge valid={isValidConcept(r.item.concept.invalidReason)} invalidReason={r.item.concept.invalidReason} />,
    },
    flagColumn('isExcluded', 80),
    flagColumn('includeDescendants', 95),
    flagColumn('includeMapped', 80),
    {
      id: 'actions',
      header: '',
      accessor: () => '',
      size: 70,
      sortable: false,
      align: 'right',
      cell: (r) => (
        <span className="inline-flex gap-0.5" onClick={(e) => e.stopPropagation()}>
          {isCustomId(r.item.concept.conceptId) && (
            <Button variant="ghost" size="icon-xs" aria-label={t('expression.custom.edit')} title={t('expression.custom.edit')} onClick={() => setEditing(r.index)}>
              <Pencil />
            </Button>
          )}
          <Button variant="ghost" size="icon-xs" aria-label={t('expression.delete_one')} title={t('expression.delete_one')} onClick={() => setConfirmDelete([r.index])}>
            <Trash2 />
          </Button>
        </span>
      ),
    },
  ]

  const selectedIndexes = [...selected].map(Number)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus size={14} />
          {t('expression.add')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
          <FileJson size={14} />
          {t('expression.import_atlas')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setOptimizeOpen(true)} disabled={!items.length}>
          <Wand2 size={14} />
          {t('expression.optimize')}
        </Button>
        {selected.size > 0 && (
          <Button size="sm" variant="outline" className="text-destructive" onClick={() => setConfirmDelete(selectedIndexes)}>
            <Trash2 size={14} />
            {t('expression.delete_selected', { count: selected.size })}
          </Button>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">{t('expression.count', { count: items.length })}</span>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={Layers}
          title={t('expression.empty_title')}
          description={t('expression.empty_description')}
          action={
            <Button onClick={() => setAddOpen(true)}>
              <Plus size={14} />
              {t('expression.add')}
            </Button>
          }
        />
      ) : (
        <DataTable
          data={rows}
          columns={columns}
          rowKey={(r) => r.index}
          onRowClick={(r) => onSelect(r.item.concept as ConceptInfo)}
          rowClassName={(r) => (r.item.isExcluded ? 'text-muted-foreground line-through decoration-muted-foreground/40' : undefined)}
          selectedRowKeys={selected}
          onSelectedRowKeysChange={setSelected}
          cellTooltips="all"
          pageSize={100}
          viewKey="concept-set-expression-edit"
        />
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
        title={t('expression.delete_title', { count: confirmDelete?.length ?? 0 })}
        description={t('expression.delete_description')}
        confirmLabel={t('expression.delete_confirm')}
        onConfirm={() => {
          if (confirmDelete) change(removeItems(items, confirmDelete))
          setConfirmDelete(null)
        }}
      />
      {addOpen && <AddConceptsDialog open={addOpen} onOpenChange={setAddOpen} items={items} onChange={change} />}
      {importOpen && <ImportAtlasDialog open={importOpen} onOpenChange={setImportOpen} items={items} onChange={change} />}
      {optimizeOpen && (
        <OptimizeDialog open={optimizeOpen} onOpenChange={setOptimizeOpen} conceptSetId={conceptSetId} items={items} onApply={change} />
      )}
      {editing !== null && items[editing] && (
        <CustomConceptDialog
          open
          onOpenChange={(open) => !open && setEditing(null)}
          items={items}
          index={editing}
          onChange={(next) => {
            change(next)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

