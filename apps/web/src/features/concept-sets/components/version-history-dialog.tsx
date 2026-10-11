import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { DataTable, type DataTableColumn } from '@/components/ui/data-table'
import { DialogShell } from '@/components/ui/dialog-shell'
import { isReachable } from '../lib/navigation'
import type { VersionInfo } from '@/lib/data'

interface VersionHistoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  versions: VersionInfo[]
  /** The version on screen. */
  shownVersion: string | null
  onPick: (version: VersionInfo) => void
}

export function VersionHistoryDialog({ open, onOpenChange, versions, shownVersion, onPick }: VersionHistoryDialogProps) {
  const { t } = useTranslation()
  const columns: DataTableColumn<VersionInfo>[] = [
    {
      id: 'version',
      header: t('concept_sets.columns.version'),
      accessor: (v) => v.version,
      size: 130,
      sortable: false,
      cell: (v) => (
        <span className="flex items-center gap-1.5">
          <span className="font-mono">{v.version}</span>
          {v.isCurrent && <Badge variant="secondary">{t('concept_sets.versions.current')}</Badge>}
          {v.version === shownVersion && !v.isCurrent && <Badge variant="outline">{t('concept_sets.versions.shown')}</Badge>}
        </span>
      ),
    },
    { id: 'date', header: t('concept_sets.versions.date'), accessor: (v) => v.date, size: 100 },
    { id: 'author', header: t('concept_sets.versions.author'), accessor: (v) => v.author, size: 150 },
    { id: 'message', header: t('concept_sets.versions.message'), accessor: (v) => v.message, size: 380 },
    {
      id: 'commit',
      header: t('concept_sets.versions.commit'),
      accessor: (v) => (v.commit ? v.commit.slice(0, 9) : isReachable(v) ? '' : t('concept_sets.versions.unavailable')),
      size: 120,
      cellClassName: 'font-mono',
      hidden: true,
    },
  ]

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      kind="workbench"
      title={t('concept_sets.versions.title')}
      description={t('concept_sets.versions.description')}
    >
      <DataTable
        data={versions}
        columns={columns}
        rowKey={(v) => v.version}
        selectedRowKey={shownVersion}
        onRowClick={(v) => isReachable(v) && onPick(v)}
        rowClassName={(v) => (isReachable(v) ? undefined : 'cursor-not-allowed opacity-50')}
        emptyMessage={t('concept_sets.versions.empty')}
      />
    </DialogShell>
  )
}
