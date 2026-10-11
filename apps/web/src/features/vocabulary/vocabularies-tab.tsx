import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookA, Database, FolderInput, Hash, Loader2, Tag, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DataTable, type DataTableColumn } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { Progress } from '@/components/ui/progress'
import { SectionLabel } from '@/components/ui/section-label'
import { Skeleton } from '@/components/ui/skeleton'
import { StatCard } from '@/components/ui/stat-card'
import { getImportJob, removeLibrary, removeVocabulary, type ImportJob } from '@/lib/vocabulary/api-admin'
import { BrowserImportDialog } from './browser-import-dialog'
import { ConfirmRemove } from './confirm-remove'
import { formatBytes, percent } from './format'
import { ServerImportDialog } from './server-import-dialog'
import { useVocabularyView, type VocabularyView } from './use-vocabulary-view'

interface Row {
  vocabularyId: string
  vocabularyName: string | null
  vocabularyVersion: string | null
  conceptCount: number
  sizeBytes?: number
  importedAt?: string
  source?: string
}

const POLL_MS = 1000

function rowsOf(view: VocabularyView): Row[] {
  return view.kind === 'server-admin' ? view.status.vocabularies : view.info.vocabularies
}

function availableOf(view: VocabularyView): boolean {
  return view.kind === 'server-admin' ? view.status.available : view.info.available
}

/** Settings → Vocabularies: the loaded OMOP vocabularies, their import and removal. */
export function VocabulariesTab() {
  const { t, i18n } = useTranslation()
  const { view, error, reload, canManage } = useVocabularyView()
  const [importOpen, setImportOpen] = useState(false)
  const [removing, setRemoving] = useState<string | 'all' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [job, setJob] = useState<ImportJob | null>(null)
  const [jobError, setJobError] = useState<string | null>(null)

  const running = view?.kind === 'server-admin' ? view.status.jobs.find((j) => j.status === 'running') : undefined
  const followedJobId = job?.status === 'running' ? job.id : running?.id

  // Server mode: follow a running import until it ends, then refresh the status.
  useEffect(() => {
    if (!followedJobId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const next = await getImportJob(followedJobId)
        if (cancelled) return
        setJob(next)
        if (next.status === 'running') {
          timer = setTimeout(poll, POLL_MS)
          return
        }
        if (next.status === 'error') setJobError(next.error ?? '')
        reload()
      } catch {
        if (!cancelled) timer = setTimeout(poll, POLL_MS * 3)
      }
    }
    timer = setTimeout(poll, POLL_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [followedJobId, reload])

  const numberFormat = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language])
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language],
  )

  const isAdmin = view?.kind === 'server-admin'
  const canImport = view?.kind === 'server-admin' || (view?.kind === 'browser' && canManage)
  const busy = job?.status === 'running' || !!running

  const columns: DataTableColumn<Row>[] = [
    { id: 'vocabularyId', header: t('vocabulary.col_id'), accessor: (r) => r.vocabularyId, filter: 'text' },
    { id: 'vocabularyName', header: t('vocabulary.col_name'), accessor: (r) => r.vocabularyName, filter: 'text' },
    { id: 'vocabularyVersion', header: t('vocabulary.col_version'), accessor: (r) => r.vocabularyVersion, filter: 'text' },
    {
      id: 'conceptCount',
      header: t('vocabulary.col_concepts'),
      accessor: (r) => r.conceptCount,
      display: (r) => numberFormat.format(r.conceptCount),
      filter: 'number',
    },
  ]
  if (isAdmin) {
    columns.push(
      {
        id: 'sizeBytes',
        header: t('vocabulary.col_size'),
        accessor: (r) => r.sizeBytes ?? null,
        display: (r) => formatBytes(r.sizeBytes),
        filter: 'none',
      },
      {
        id: 'importedAt',
        header: t('vocabulary.col_imported'),
        accessor: (r) => r.importedAt ?? null,
        display: (r) => (r.importedAt ? dateFormat.format(new Date(r.importedAt)) : ''),
        filter: 'none',
      },
      {
        id: 'actions',
        header: t('vocabulary.col_actions'),
        accessor: () => null,
        sortable: false,
        filter: 'none',
        cell: (r) => (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('vocabulary.remove_one', { id: r.vocabularyId })}
            disabled={busy}
            onClick={() => setRemoving(r.vocabularyId)}
          >
            <Trash2 size={12} />
          </Button>
        ),
      },
    )
  }

  const handleRemove = async () => {
    const target = removing
    setRemoving(null)
    setActionError(null)
    try {
      if (view?.kind === 'browser') {
        const { removeBrowserVocabulary } = await import('@/lib/vocabulary/wasm/library')
        await removeBrowserVocabulary()
      } else if (target === 'all') {
        await removeLibrary()
      } else if (target) {
        await removeVocabulary(target)
      }
    } catch (e) {
      console.error('Vocabulary removal failed:', e)
      setActionError(t('vocabulary.remove_error'))
    }
    reload()
  }

  if (error) {
    return <NoticeBanner tone="danger" title={t('vocabulary.status_error')} action={<Button variant="outline" size="xs" onClick={reload}>{t('vocabulary.retry')}</Button>} />
  }
  if (!view) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[74px] rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  const available = availableOf(view)
  const rows = rowsOf(view)
  const release = view.kind === 'server-admin' ? view.status.release : view.info.release
  const totalConcepts = rows.reduce((n, r) => n + (r.conceptCount ?? 0), 0)
  const shownJob = job ?? running ?? null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          {view.kind === 'browser' ? t('vocabulary.intro_browser') : t('vocabulary.intro_server')}
        </p>
        {canImport && (
          <div className="flex gap-2">
            {available && (
              <Button variant="outline" disabled={busy} onClick={() => setRemoving('all')}>
                <Trash2 size={14} />
                {t('vocabulary.remove_all')}
              </Button>
            )}
            <Button disabled={busy} onClick={() => setImportOpen(true)}>
              <FolderInput size={14} />
              {t('vocabulary.import')}
            </Button>
          </div>
        )}
      </div>

      {shownJob?.status === 'running' && (
        <NoticeBanner
          tone="progress"
          title={t('vocabulary.job_running', { step: shownJob.step || '…' })}
          description={
            <div className="mt-2 flex items-center gap-3">
              <Progress value={percent(shownJob.done, shownJob.total)} className="max-w-sm" />
              <span className="text-xs tabular-nums text-muted-foreground">
                {shownJob.done}/{shownJob.total || '…'}
              </span>
              <Loader2 size={14} className="animate-spin text-muted-foreground" />
            </div>
          }
        />
      )}
      {jobError !== null && (
        <NoticeBanner
          tone="danger"
          title={t('vocabulary.job_failed')}
          description={jobError || undefined}
          onDismiss={() => setJobError(null)}
        />
      )}
      {actionError && <NoticeBanner tone="danger" title={actionError} onDismiss={() => setActionError(null)} />}
      {view.kind === 'browser' && view.meta && !available && (
        <NoticeBanner tone="warning" title={t('vocabulary.browser_restore_failed')} />
      )}

      {!available ? (
        <EmptyState
          icon={BookA}
          title={t('vocabulary.empty_title')}
          description={canImport ? t('vocabulary.empty_description') : t('vocabulary.empty_reader')}
          action={
            canImport ? (
              <Button disabled={busy} onClick={() => setImportOpen(true)}>
                <FolderInput size={14} />
                {t('vocabulary.import')}
              </Button>
            ) : undefined
          }
          className="mt-4"
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard
              icon={<Tag size={16} />}
              iconBg="bg-primary/10 text-primary"
              value={<span className="text-sm font-semibold">{release ?? t('vocabulary.unknown')}</span>}
              label={t('vocabulary.release')}
            />
            <StatCard
              icon={<BookA size={16} />}
              iconBg="bg-primary/10 text-primary"
              value={numberFormat.format(rows.length)}
              label={t('vocabulary.vocabularies')}
            />
            <StatCard
              icon={<Hash size={16} />}
              iconBg="bg-primary/10 text-primary"
              value={numberFormat.format(totalConcepts)}
              label={t('vocabulary.concepts')}
            />
          </div>

          {view.kind === 'browser' && view.meta && (
            <p className="text-xs text-muted-foreground">
              {t('vocabulary.browser_meta', {
                source: view.meta.source,
                date: dateFormat.format(new Date(view.meta.importedAt)),
              })}{' '}
              {view.meta.filtered ? t('vocabulary.browser_filtered') : t('vocabulary.browser_unfiltered')}
            </p>
          )}

          <DataTable data={rows} columns={columns} rowKey={(r) => r.vocabularyId} pageSize={50} />

          {(view.kind === 'server-admin' || (view.kind === 'browser' && view.meta)) && (
            <TableCounts
              counts={view.kind === 'server-admin' ? view.status.rowCounts : view.kind === 'browser' ? (view.meta?.rowCounts ?? {}) : {}}
              format={(n) => numberFormat.format(n)}
            />
          )}
        </>
      )}

      {view.kind === 'server-admin' && (
        <ServerImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          importRoots={view.status.importRoots}
          onStarted={(started) => {
            setJobError(null)
            setJob(started)
          }}
        />
      )}
      {view.kind === 'browser' && <BrowserImportDialog open={importOpen} onOpenChange={setImportOpen} onDone={reload} />}

      <ConfirmRemove
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={removing === 'all' ? t('vocabulary.remove_all_title') : t('vocabulary.remove_one_title', { id: removing })}
        description={view.kind === 'browser' ? t('vocabulary.remove_browser_description') : t('vocabulary.remove_description')}
        onConfirm={handleRemove}
      />
    </div>
  )
}

function TableCounts({ counts, format }: { counts: Record<string, number>; format: (n: number) => string }) {
  const { t } = useTranslation()
  const entries = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))
  if (!entries.length) return null
  return (
    <div>
      <SectionLabel as="h3" className="mb-2 flex items-center gap-1.5">
        <Database size={12} />
        {t('vocabulary.tables')}
      </SectionLabel>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
        {entries.map(([table, n]) => (
          <div key={table} className="flex justify-between gap-2 border-b py-1 text-xs">
            <dt className="font-mono text-muted-foreground">{table}</dt>
            <dd className="tabular-nums">{format(n)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
