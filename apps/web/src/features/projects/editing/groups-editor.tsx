import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowRight, ArrowUp, Layers, Minus, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DataTable, type DataTableColumn } from '@/components/ui/data-table'
import { DialogShell } from '@/components/ui/dialog-shell'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { SectionLabel } from '@/components/ui/section-label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { GROUP_RULES, groupName } from '@/lib/coverage/groups'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from '@/features/drafts/confirm-dialog'
import { ReviewStatusBadge } from '../project-badges'
import {
  addConceptSet,
  addGroup,
  deleteGroup,
  groupOf,
  moveConceptSets,
  moveGroup,
  removeConceptSets,
  renameGroup,
  setGroupRule,
} from '../lib/project-editing'
import type { GroupRule, ProjectGroup, ReviewStatus } from '@data-dictionary/format'
import type { ConceptSetSummary } from '@/lib/data'

interface GroupsEditorProps {
  groups: ProjectGroup[]
  onChange: (groups: ProjectGroup[]) => void
  /** The concept sets the user sees (drafts overlaid). */
  summaries: readonly ConceptSetSummary[]
  lang: string
  languages: readonly string[]
}

interface Row {
  id: number
  name: string
  category: string
  subcategory: string
  status: ReviewStatus | null
  version: string
  /** In the project: its group id and pinned version. */
  groupId?: string
  pinned?: string
}

function toRow(s: ConceptSetSummary, lang: string): Row {
  const tr = s.translations[lang]
  return { id: s.id, name: tr?.name ?? '', category: tr?.category ?? '', subcategory: tr?.subcategory ?? '', status: s.reviewStatus, version: s.version }
}

/**
 * The concept sets of a project in edit mode (v1's two panels): the groups
 * (rule, name per language, order), the sets available on the left (added to
 * the active group at their current version), the project's on the right
 * (change group, bulk move, remove).
 */
export function GroupsEditor({ groups, onChange, summaries, lang, languages }: GroupsEditorProps) {
  const { t } = useTranslation()
  const [active, setActive] = useState(groups[0]?.id ?? '')
  const [availableSelection, setAvailableSelection] = useState<Set<string | number>>(new Set())
  const [projectSelection, setProjectSelection] = useState<Set<string | number>>(new Set())
  const [moveTarget, setMoveTarget] = useState('')
  const [renaming, setRenaming] = useState<ProjectGroup | null>(null)
  const [deleting, setDeleting] = useState<ProjectGroup | null>(null)
  const activeId = groups.some((g) => g.id === active) ? active : (groups[0]?.id ?? '')
  const label = (g: ProjectGroup) => groupName(g, lang) || t('projects.unnamed_group')

  const byId = useMemo(() => new Map(summaries.map((s) => [s.id, s])), [summaries])
  const available = useMemo(() => summaries.filter((s) => !groupOf(groups, s.id)).map((s) => toRow(s, lang)), [summaries, groups, lang])
  const inProject = useMemo(
    () =>
      groups.flatMap((g) =>
        (g.conceptSets ?? []).map((e) => {
          const s = byId.get(e.id)
          const base: Row = s ? toRow(s, lang) : { id: e.id, name: '', category: '', subcategory: '', status: null, version: '' }
          return { ...base, groupId: g.id, pinned: e.version }
        }),
      ),
    [groups, byId, lang],
  )

  const add = (ids: number[]) => {
    let next = groups
    for (const id of ids) next = addConceptSet(next, activeId, id, byId.get(id)?.version ?? '')
    onChange(next)
    setAvailableSelection(new Set())
  }
  const remove = (ids: number[]) => {
    onChange(removeConceptSets(groups, ids))
    setProjectSelection(new Set())
  }

  const common: DataTableColumn<Row>[] = [
    { id: 'name', header: t('projects.col.name'), accessor: (r) => r.name || `#${r.id}`, filter: 'text', size: 240 },
    { id: 'category', header: t('projects.col.category'), accessor: (r) => r.category, filter: 'select', size: 130 },
    { id: 'subcategory', header: t('projects.col.subcategory'), accessor: (r) => r.subcategory, filter: 'select', size: 130, hidden: true },
    {
      id: 'status',
      header: t('projects.col.status'),
      accessor: (r) => r.status,
      filter: 'select',
      selectOptionLabel: (v) => t(`projects.review_status.${v}`),
      cell: (r) => <ReviewStatusBadge status={r.status} />,
      size: 120,
      hidden: true,
    },
  ]
  const availableColumns: DataTableColumn<Row>[] = [
    ...common,
    {
      id: 'add',
      header: '',
      accessor: () => '',
      sortable: false,
      size: 44,
      cell: (r) => (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t('projects.edit.add_set')}
          onClick={(e) => {
            e.stopPropagation()
            add([r.id])
          }}
        >
          <Plus />
        </Button>
      ),
    },
  ]
  // Half the page width from xl up (~480px at 1280px): name, group, pinned version
  // and remove fit; the category stays one click away in the column menu.
  const projectColumns: DataTableColumn<Row>[] = [
    ...common.map((c) => (c.id === 'name' ? { ...c, size: 200 } : c.id === 'category' ? { ...c, hidden: true } : c)),
    {
      id: 'group',
      header: t('projects.edit.group'),
      accessor: (r) => r.groupId ?? '',
      size: 130,
      cell: (r) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Select value={r.groupId} onValueChange={(g) => onChange(moveConceptSets(groups, [r.id], g))}>
            <SelectTrigger size="xs" className="w-full" aria-label={t('projects.edit.group')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {label(g)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ),
    },
    { id: 'pinned', header: t('projects.col.pinned_version'), accessor: (r) => r.pinned ?? '', size: 90, cellClassName: 'font-mono' },
    {
      id: 'remove',
      header: '',
      accessor: () => '',
      sortable: false,
      size: 44,
      cell: (r) => (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t('projects.edit.remove_set')}
          onClick={(e) => {
            e.stopPropagation()
            remove([r.id])
          }}
        >
          <Minus />
        </Button>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <section className="rounded-md border p-3">
        <div className="mb-2 flex items-center justify-between">
          <SectionLabel as="h3" className="flex items-center gap-1.5">
            <Layers size={12} />
            {t('projects.edit.groups')}
          </SectionLabel>
          <Button variant="outline" size="xs" onClick={() => onChange(addGroup(groups, languages))}>
            <Plus size={12} />
            {t('projects.edit.add_group')}
          </Button>
        </div>
        <div className="space-y-1">
          {groups.map((g, i) => (
            <div
              key={g.id}
              className={cn('flex items-center gap-2 rounded-md border px-2 py-1', g.id === activeId ? 'border-primary bg-primary/5' : 'border-transparent')}
            >
              <button type="button" className="min-w-0 flex-1 truncate text-left text-sm" onClick={() => setActive(g.id)} aria-pressed={g.id === activeId}>
                <span className="font-medium">{label(g)}</span>{' '}
                <span className="text-xs text-muted-foreground">({(g.conceptSets ?? []).length})</span>
              </button>
              <Select value={g.rule} onValueChange={(rule) => onChange(setGroupRule(groups, g.id, rule as GroupRule))}>
                <SelectTrigger size="xs" className="w-36" aria-label={t('projects.edit.rule')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GROUP_RULES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {t(`projects.rule.${r}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="icon-xs" aria-label={t('projects.edit.rename')} onClick={() => setRenaming(g)}>
                <Pencil />
              </Button>
              <Button variant="ghost" size="icon-xs" aria-label={t('projects.edit.move_up')} disabled={i === 0} onClick={() => onChange(moveGroup(groups, g.id, 'up'))}>
                <ArrowUp />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t('projects.edit.move_down')}
                disabled={i === groups.length - 1}
                onClick={() => onChange(moveGroup(groups, g.id, 'down'))}
              >
                <ArrowDown />
              </Button>
              <Button variant="ghost" size="icon-xs" aria-label={t('projects.edit.delete_group')} disabled={groups.length <= 1} onClick={() => setDeleting(g)}>
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t('projects.edit.active_group_hint')}</p>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="min-w-0">
          <div className="mb-2 flex h-7 items-center justify-between gap-2">
            <SectionLabel as="h3">{t('projects.edit.available', { count: available.length })}</SectionLabel>
            {availableSelection.size > 0 && (
              <Button size="xs" onClick={() => add([...availableSelection].map(Number))}>
                <ArrowRight size={12} />
                {t('projects.edit.add_selected', { count: availableSelection.size, group: label(groups.find((g) => g.id === activeId) ?? groups[0]) })}
              </Button>
            )}
          </div>
          <DataTable
            data={available}
            columns={availableColumns}
            rowKey={(r) => r.id}
            selectedRowKeys={availableSelection}
            onSelectedRowKeysChange={setAvailableSelection}
            pageSize={50}
            density="compact"
            viewKey="project-edit-available"
          />
        </section>
        <section className="min-w-0">
          <div className="mb-2 flex h-7 items-center justify-between gap-2">
            <SectionLabel as="h3">{t('projects.edit.in_project', { count: inProject.length })}</SectionLabel>
            {projectSelection.size > 0 && (
              <div className="flex items-center gap-1">
                <Select value={moveTarget} onValueChange={setMoveTarget}>
                  <SelectTrigger size="xs" className="w-36" aria-label={t('projects.edit.move_to')}>
                    <SelectValue placeholder={t('projects.edit.move_to')} />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {label(g)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!moveTarget}
                  onClick={() => {
                    onChange(moveConceptSets(groups, [...projectSelection].map(Number), moveTarget))
                    setProjectSelection(new Set())
                  }}
                >
                  {t('projects.edit.move', { count: projectSelection.size })}
                </Button>
                <Button size="xs" variant="outline" onClick={() => remove([...projectSelection].map(Number))}>
                  <Minus size={12} />
                  {t('projects.edit.remove_selected', { count: projectSelection.size })}
                </Button>
              </div>
            )}
          </div>
          <DataTable
            data={inProject}
            columns={projectColumns}
            rowKey={(r) => r.id}
            selectedRowKeys={projectSelection}
            onSelectedRowKeysChange={setProjectSelection}
            emptyMessage={t('projects.no_concept_sets')}
            pageSize={50}
            density="compact"
            viewKey="project-edit-in-project"
          />
        </section>
      </div>

      <RenameGroupDialog
        group={renaming}
        languages={languages}
        onOpenChange={(o) => !o && setRenaming(null)}
        onSubmit={(names) => {
          if (renaming) onChange(renameGroup(groups, renaming.id, names))
          setRenaming(null)
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('projects.edit.delete_group_title', { name: deleting ? label(deleting) : '' })}
        description={
          deleting && (deleting.conceptSets ?? []).length > 0
            ? t('projects.edit.delete_group_move', {
                count: (deleting.conceptSets ?? []).length,
                target: label(groups.find((g) => g.id !== deleting.id) ?? deleting),
              })
            : undefined
        }
        confirmLabel={t('projects.edit.delete_group')}
        onConfirm={() => {
          if (deleting) onChange(deleteGroup(groups, deleting.id))
          setDeleting(null)
        }}
      />
    </div>
  )
}

interface RenameGroupDialogProps {
  group: ProjectGroup | null
  languages: readonly string[]
  onOpenChange: (open: boolean) => void
  onSubmit: (names: Record<string, string>) => void
}

function RenameGroupDialog({ group, languages, onOpenChange, onSubmit }: RenameGroupDialogProps) {
  const { t } = useTranslation()
  const [names, setNames] = useState<Record<string, string>>({})
  const [last, setLast] = useState<ProjectGroup | null>(null)
  if (group !== last) {
    setLast(group)
    if (group) setNames(Object.fromEntries(languages.map((l) => [l, groupName(group, l) ?? ''])))
  }
  const empty = !Object.values(names).some((n) => n.trim())
  return (
    <DialogShell
      open={group !== null}
      onOpenChange={onOpenChange}
      title={t('projects.edit.rename_title')}
      onConfirm={() => onSubmit(names)}
      confirmDisabled={empty}
    >
      {languages.map((l) => (
        <FormField key={l} label={`${t('projects.edit.name')} (${l.toUpperCase()})`}>
          {({ id }) => <Input id={id} value={names[l] ?? ''} onChange={(e) => setNames((n) => ({ ...n, [l]: e.target.value }))} />}
        </FormField>
      ))}
    </DialogShell>
  )
}
