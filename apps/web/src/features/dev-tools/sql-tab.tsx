import { Suspense, lazy, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Download, Loader2, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DataTable, type DataTableColumn } from '@/components/ui/data-table'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { isServerMode } from '@/lib/api-client'
import { downloadText } from '@/lib/export/download'
import { SqlQueryError, VocabularyUnavailableError, getVocabularySource, type SqlResult } from '@/lib/vocabulary'
import { useHasPermission } from '@/stores/auth-store'
import { useVocabularyQuery } from '@/features/vocabulary/use-vocabulary-query'
import { EXAMPLE_QUERIES } from './examples'
import { resultCsv } from './results-csv'

const CodeEditor = lazy(() => import('@/components/editor/code-editor').then((m) => ({ default: m.CodeEditor })))

const DRAFT_KEY = 'dd-dev-tools-sql'
const ROW_LIMIT = 1000

function readDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? EXAMPLE_QUERIES[0].sql
  } catch {
    return EXAMPLE_QUERIES[0].sql
  }
}

function writeDraft(sql: string): void {
  try {
    localStorage.setItem(DRAFT_KEY, sql)
  } catch {
    // private mode: the draft is a convenience only
  }
}

type ResultRow = { key: number; cells: unknown[] }

function cellText(value: unknown): string | number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' || typeof value === 'string') return value
  if (typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/** SQL against the loaded vocabulary: Monaco editor, v1's examples, a results table and CSV export. */
export function SqlTab() {
  const { t } = useTranslation()
  const allowed = useHasPermission('settings:manage')
  const info = useVocabularyQuery(allowed ? 'info' : null, () => getVocabularySource().getInfo())
  const [sql, setSql] = useState(readDraft)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<SqlResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const runId = useRef(0)

  const run = async () => {
    if (running || !sql.trim()) return
    const id = ++runId.current
    setRunning(true)
    setError(null)
    try {
      const r = await getVocabularySource().runSql(sql, { limit: ROW_LIMIT })
      if (id !== runId.current) return
      setResult(r)
    } catch (e) {
      if (id !== runId.current) return
      setResult(null)
      if (e instanceof SqlQueryError) setError(e.refusal ? t(`dev_tools.refusal.${e.refusal}`) : e.message)
      else if (e instanceof VocabularyUnavailableError) setError(t('dev_tools.no_vocabulary'))
      else {
        console.error('SQL query failed:', e)
        setError(t('dev_tools.query_failed', { message: e instanceof Error ? e.message : String(e) }))
      }
    } finally {
      if (id === runId.current) setRunning(false)
    }
  }

  const rows = useMemo<ResultRow[]>(() => (result ? result.rows.map((cells, key) => ({ key, cells })) : []), [result])
  const columns = useMemo<DataTableColumn<ResultRow>[]>(
    () =>
      (result?.columns ?? []).map((name, i) => ({
        id: `c${i}`,
        header: name,
        accessor: (r: ResultRow) => cellText(r.cells[i]),
        filter: 'text' as const,
      })),
    [result],
  )

  if (!allowed) {
    return <NoticeBanner tone="warning" title={t('dev_tools.admin_only')} description={t('dev_tools.admin_only_hint')} />
  }

  const unavailable = info.status === 'ready' ? !info.data.available : info.status === 'unavailable'

  return (
    <div className="flex flex-col gap-3">
      {unavailable && (
        <NoticeBanner
          tone="warning"
          title={t('dev_tools.no_vocabulary')}
          action={
            <Button asChild variant="outline" size="sm">
              <Link to="/settings/vocabularies">{t('dev_tools.load_vocabulary')}</Link>
            </Button>
          }
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value=""
          onValueChange={(id) => {
            const q = EXAMPLE_QUERIES.find((e) => e.id === id)
            if (q) {
              setSql(q.sql)
              writeDraft(q.sql)
            }
          }}
        >
          <SelectTrigger size="sm" className="w-64 text-xs">
            <SelectValue placeholder={t('dev_tools.examples_placeholder')} />
          </SelectTrigger>
          <SelectContent>
            {EXAMPLE_QUERIES.map((q) => (
              <SelectItem key={q.id} value={q.id} className="text-xs">
                {t(`dev_tools.examples.${q.id}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-[10px] text-muted-foreground">
          {isServerMode() ? t('dev_tools.engine_server') : t('dev_tools.engine_browser')}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            disabled={!result || result.rowCount === 0}
            onClick={() => result && downloadText('query_result.csv', resultCsv(result.columns, result.rows), 'text/csv;charset=utf-8')}
          >
            <Download size={14} />
            {t('dev_tools.export_csv')}
          </Button>
          <Button onClick={run} disabled={running || !sql.trim()}>
            {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {t('dev_tools.run')}
          </Button>
        </div>
      </div>
      <div className="h-60 overflow-hidden rounded-md border">
        <Suspense fallback={<Skeleton className="h-full w-full" />}>
          <CodeEditor
            value={sql}
            onChange={(v) => {
              setSql(v)
              writeDraft(v)
            }}
            onRun={run}
            ariaLabel={t('dev_tools.editor_label')}
          />
        </Suspense>
      </div>
      <p className="text-[10px] text-muted-foreground">{t('dev_tools.editor_hint', { limit: ROW_LIMIT })}</p>

      {error && <NoticeBanner tone="danger" title={t('dev_tools.query_error')} description={error} />}
      {result && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{t('dev_tools.row_count', { count: result.rowCount })}</span>
            <span>·</span>
            <span>{t('dev_tools.elapsed', { ms: result.elapsedMs })}</span>
            {result.truncated && <span className="text-amber-700 dark:text-amber-400">· {t('dev_tools.truncated', { limit: ROW_LIMIT })}</span>}
          </div>
          {result.columns.length > 0 && (
            <DataTable
              data={rows}
              columns={columns}
              rowKey={(r) => r.key}
              pageSize={50}
              density="compact"
              cellTooltips="all"
              emptyMessage={t('dev_tools.no_rows')}
            />
          )}
        </div>
      )}
    </div>
  )
}
