import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { Loader2, Plus, Trash2, Upload } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTable, type DataTableColumn } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { isServerMode } from '@/lib/api-client'
import { useHasPermission } from '@/stores/auth-store'
import { useMappingsStore } from '@/stores/mappings-store'
import { formatContentDate } from '@/features/projects/format'
import { ImportCoverage } from './coverage/import-coverage'
import type { MappingImportSummary } from '@/lib/mappings'

const ImportDialog = lazy(() => import('./coverage/import-dialog').then((m) => ({ default: m.ImportDialog })))

/**
 * Coverage of imported mappings against the projects (v2 plan §7, v1's
 * Eligibility tab). URL: `?tab=coverage&import=<id>&project=<id>&detail=<csId>&version=<v>`.
 */
export function CoverageTab() {
  const [searchParams, setSearchParams] = useSearchParams()
  const importId = searchParams.get('import')

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams)
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k)
      else next.set(k, v)
    }
    setSearchParams(next, { replace: true })
  }

  if (importId) {
    return (
      <ImportCoverage
        importId={importId}
        projectId={Number(searchParams.get('project')) || null}
        detail={Number(searchParams.get('detail')) || null}
        detailVersion={searchParams.get('version') ?? ''}
        onChange={update}
      />
    )
  }
  return <ImportList onOpen={(id) => update({ import: id })} />
}

function ImportList({ onOpen }: { onOpen: (id: string) => void }) {
  const { t, i18n } = useTranslation()
  const imports = useMappingsStore((s) => s.imports)
  const loadImports = useMappingsStore((s) => s.loadImports)
  const removeImport = useMappingsStore((s) => s.removeImport)
  const canWrite = useHasPermission('mappings:write')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [toRemove, setToRemove] = useState<MappingImportSummary | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)

  useEffect(() => {
    loadImports()
  }, [loadImports])

  const columns = useMemo<DataTableColumn<MappingImportSummary>[]>(
    () => [
      { id: 'name', header: t('coverage.name'), accessor: (m) => m.name, filter: 'text' },
      {
        id: 'format',
        header: t('coverage.format'),
        accessor: (m) => m.format,
        filter: 'select',
        selectOptionLabel: (v) => t(`coverage.formats.${v}`),
        cell: (m) => <Badge variant="outline">{t(`coverage.formats.${m.format}`)}</Badge>,
      },
      { id: 'file', header: t('coverage.file'), accessor: (m) => m.sourceFileName, filter: 'text' },
      { id: 'mapped', header: t('coverage.mapped_rows'), accessor: (m) => m.stats.mappedRows, align: 'right' },
      { id: 'targets', header: t('coverage.unique_targets'), accessor: (m) => m.stats.uniqueTargets, align: 'right' },
      ...(isServerMode()
        ? [{ id: 'by', header: t('coverage.created_by'), accessor: (m: MappingImportSummary) => m.createdBy ?? '' }]
        : []),
      {
        id: 'date',
        header: t('coverage.created_at'),
        accessor: (m) => m.createdAt,
        display: (m) => formatContentDate(m.createdAt, i18n.language),
      },
      ...(canWrite
        ? [
            {
              id: 'actions',
              header: '',
              accessor: () => null,
              sortable: false,
              size: 48,
              cell: (m: MappingImportSummary) => (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t('coverage.delete')}
                  onClick={(e) => {
                    e.stopPropagation()
                    setToRemove(m)
                  }}
                >
                  <Trash2 size={12} />
                </Button>
              ),
            },
          ]
        : []),
    ],
    [t, i18n.language, canWrite],
  )

  const handleRemove = async () => {
    if (!toRemove) return
    setRemoveError(null)
    try {
      await removeImport(toRemove.id)
    } catch (e) {
      setRemoveError(e instanceof Error ? e.message : String(e))
    }
    setToRemove(null)
  }

  const list = imports.data ?? []
  const loading = imports.status === 'idle' || imports.status === 'loading'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-3xl text-sm text-muted-foreground">
          {t('coverage.intro')} {isServerMode() ? t('coverage.storage_server') : t('coverage.storage_local')}
        </p>
        {canWrite && (
          <Button onClick={() => setDialogOpen(true)}>
            <Plus size={14} />
            {t('coverage.new_import')}
          </Button>
        )}
      </div>
      {imports.status === 'error' && <NoticeBanner tone="danger" title={t('coverage.load_error')} description={imports.error} />}
      {removeError && <NoticeBanner tone="danger" title={t('coverage.delete_error')} description={removeError} />}
      {loading && !imports.data ? (
        <div className="flex justify-center py-12">
          <Loader2 size={20} className="animate-spin text-muted-foreground" />
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={Upload} title={t('coverage.empty_title')} description={t('coverage.empty_description')} className="mt-4" />
      ) : (
        <DataTable data={list} columns={columns} rowKey={(m) => m.id} onRowClick={(m) => onOpen(m.id)} pageSize={50} />
      )}

      {dialogOpen && (
        <Suspense fallback={null}>
          <ImportDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreated={onOpen} />
        </Suspense>
      )}

      <AlertDialog open={!!toRemove} onOpenChange={(o) => !o && setToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('coverage.delete_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('coverage.delete_description', { name: toRemove?.name ?? '' })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleRemove}>
              {t('coverage.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
