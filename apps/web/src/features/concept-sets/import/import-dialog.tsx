// Ported from legacy/concept-sets.js (openCsImportModal, setImportMode, importFetchRepo,
// importFetchSingle, renderImportResults, doImport, importPastedSingle).
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Download, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTable, type DataTableColumn } from '@/components/ui/data-table'
import { DialogShell } from '@/components/ui/dialog-shell'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ApiError, apiRequest, isServerMode } from '@/lib/api-client'
import { repositoryConfig, repositoryUrl } from '@/lib/data/forge'
import { useAuthStore } from '@/stores/auth-store'
import { useInstanceConfig } from '@/stores/config-store'
import { useDraftsStore } from '@/stores/drafts-store'
import { todayIso } from '@/features/drafts/identity'
import {
  candidateRow,
  fetchRepoCandidates,
  fetchSingleCandidate,
  importedCopy,
  pastedCandidate,
  type CandidateRow,
  type FetchJson,
  type ImportCandidate,
  type ImportStatus,
  type LocalSet,
} from '../lib/cross-repo-import'
import type { ConceptSetSummary } from '@/lib/data'

type Mode = 'repo' | 'single' | 'paste'

interface ImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The list as the user sees it (repository sets with this user's drafts over them). */
  summaries: readonly ConceptSetSummary[]
  lang: string
}

/**
 * The browser fetches the other dictionary directly (Pages sites and raw
 * forge files answer cross-origin). When that fails in server mode, the API's
 * proxy (`/import-proxy/json`, public hosts only) tries instead.
 */
function fetcher(useProxy: boolean): FetchJson {
  return async (url) => {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (error) {
      // A TypeError is a network / CORS failure: the server may reach it.
      if (!useProxy || !(error instanceof TypeError)) throw error
      try {
        return await apiRequest(`/import-proxy/json?url=${encodeURIComponent(url)}`)
      } catch (proxyError) {
        if (proxyError instanceof ApiError) throw new Error(`HTTP ${proxyError.status}`)
        throw proxyError
      }
    }
  }
}

const STATUS_RANK: Record<ImportStatus, number> = { new: 0, conflict: 1, up_to_date: 2 }

/**
 * "Import from another repository": a dictionary's catalog (repository or
 * Pages URL), one concept set (file URL) or pasted JSON. Candidates are
 * classified by lineage (`uniqueId`): new, a newer / other version of a local
 * set (imported over it, keeping its id), or already here (skipped). Each
 * import becomes a draft of this user, its `origin` recording where it came
 * from.
 */
export function ImportDialog({ open, onOpenChange, summaries, lang }: ImportDialogProps) {
  const { t } = useTranslation()
  const config = useInstanceConfig()
  const user = useAuthStore((s) => s.user)
  const saveDraft = useDraftsStore((s) => s.save)
  const newId = useDraftsStore((s) => s.newId)
  const [mode, setMode] = useState<Mode>('repo')
  const [repoUrl, setRepoUrl] = useState('')
  const [fileUrl, setFileUrl] = useState('')
  const [pasted, setPasted] = useState('')
  const [candidates, setCandidates] = useState<ImportCandidate[] | null>(null)
  const [selected, setSelected] = useState<Set<string | number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ imported: number; updated: number } | null>(null)

  const local: LocalSet[] = useMemo(() => summaries.map((s) => ({ id: s.id, uniqueId: s.uniqueId, version: s.version })), [summaries])
  const fetchJson = fetcher(isServerMode() && !!user)

  const showCandidates = (list: ImportCandidate[]) => {
    setCandidates(list)
    setSelected(new Set(list.flatMap((c, i) => (c.selected ? [i] : []))))
  }

  const errorText = (e: unknown) => {
    const m = e instanceof Error ? e.message : String(e)
    return ['invalid_url', 'invalid_json', 'not_a_concept_set'].includes(m) ? t(`cross_repo_import.error_${m}`) : m
  }

  const load = async () => {
    setBusy(true)
    setError(null)
    setDone(null)
    setCandidates(null)
    try {
      if (mode === 'repo') showCandidates(await fetchRepoCandidates(repoUrl, local, fetchJson))
      else if (mode === 'single') showCandidates([await fetchSingleCandidate(fileUrl, local, fetchJson)])
      else showCandidates([pastedCandidate(pasted, local)])
    } catch (e) {
      setError(t(mode === 'paste' ? 'cross_repo_import.paste_failed' : 'cross_repo_import.fetch_failed', { error: errorText(e) }))
    } finally {
      setBusy(false)
    }
  }

  const doImport = async () => {
    if (!candidates) return
    const chosen = candidates.filter((c, i) => selected.has(i) && c.status !== 'up_to_date')
    if (!chosen.length) return
    setBusy(true)
    setError(null)
    const ctx = {
      organization: { name: config.organization?.name ?? '', url: config.organization?.url ?? '' },
      repoUrl: repositoryUrl(repositoryConfig(config)),
      today: todayIso(),
    }
    let imported = 0
    let updated = 0
    const used = summaries.map((s) => s.id)
    try {
      for (const c of chosen) {
        if (c.status === 'conflict' && c.localId !== null) {
          await saveDraft({ kind: 'concept-set', targetId: c.localId, content: importedCopy(c, c.localId, ctx) })
          updated++
        } else {
          const id = await newId('concept-set', used)
          used.push(id)
          await saveDraft({ kind: 'concept-set', targetId: null, content: importedCopy(c, id, ctx) })
          imported++
        }
      }
      setDone({ imported, updated })
      setCandidates(null)
    } catch (e) {
      console.error('Could not import the concept sets', e)
      setError(t('cross_repo_import.import_failed', { error: errorText(e) }))
      if (imported || updated) setDone({ imported, updated })
    } finally {
      setBusy(false)
    }
  }

  const rows: (CandidateRow & { key: number })[] = useMemo(
    () => (candidates ?? []).map((c, i) => ({ ...candidateRow(c, i, lang), key: i })).sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.name.localeCompare(b.name)),
    [candidates, lang],
  )
  const statusLabel = (s: ImportStatus) => t(`cross_repo_import.status_${s}`)
  const columns: DataTableColumn<CandidateRow & { key: number }>[] = [
    { id: 'category', header: t('concept_sets.columns.category'), accessor: (r) => r.category, filter: 'select', size: 140 },
    { id: 'subcategory', header: t('concept_sets.columns.subcategory'), accessor: (r) => r.subcategory, filter: 'select', size: 140 },
    { id: 'name', header: t('concept_sets.columns.name'), accessor: (r) => r.name, filter: 'text', size: 260 },
    { id: 'version', header: t('concept_sets.columns.version'), accessor: (r) => r.version, filter: 'text', size: 80, align: 'center' },
    { id: 'organization', header: t('cross_repo_import.organization'), accessor: (r) => r.organization, filter: 'select', size: 160 },
    {
      id: 'status',
      header: t('cross_repo_import.status'),
      accessor: (r) => statusLabel(r.status),
      filter: 'select',
      size: 150,
      cell: (r) => (
        <Badge variant={r.status === 'new' ? 'default' : r.status === 'conflict' ? 'outline' : 'secondary'} className={r.status === 'conflict' ? 'border-amber-500/60 text-amber-700 dark:text-amber-400' : undefined}>
          {statusLabel(r.status)}
        </Badge>
      ),
    },
    { id: 'description', header: t('cross_repo_import.description'), accessor: (r) => r.description, filter: 'text', size: 260, hidden: true },
  ]

  const selectable = [...selected].filter((k) => candidates?.[Number(k)]?.status !== 'up_to_date')
  const canLoad = mode === 'repo' ? !!repoUrl.trim() : mode === 'single' ? !!fileUrl.trim() : !!pasted.trim()

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      kind="workbench"
      title={t('cross_repo_import.title')}
      description={t('cross_repo_import.description_text')}
      onConfirm={candidates ? () => void doImport() : () => void load()}
      confirmLabel={candidates ? t('cross_repo_import.import', { count: selectable.length }) : t('cross_repo_import.load')}
      confirmDisabled={busy || (candidates ? selectable.length === 0 : !canLoad)}
      busy={busy}
      noEnterSubmit
      contentClassName="flex flex-col gap-3"
    >
      <Tabs
        value={mode}
        onValueChange={(v) => {
          setMode(v as Mode)
          setCandidates(null)
          setError(null)
        }}
      >
        <TabsList className="w-full">
          {(['repo', 'single', 'paste'] as const).map((m) => (
            <TabsTrigger key={m} value={m} className="flex-1">
              {t(`cross_repo_import.mode_${m}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {mode === 'repo' && (
        <FormField label={t('cross_repo_import.repo_url')} hint={t('cross_repo_import.repo_url_hint')}>
          {({ id }) => <Input id={id} value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/indicate-eu/data-dictionary" />}
        </FormField>
      )}
      {mode === 'single' && (
        <FormField label={t('cross_repo_import.file_url')} hint={t('cross_repo_import.file_url_hint')}>
          {({ id }) => <Input id={id} value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} placeholder="https://github.com/…/blob/main/concept_sets/12.json" />}
        </FormField>
      )}
      {mode === 'paste' && !candidates && (
        <Textarea value={pasted} onChange={(e) => setPasted(e.target.value)} className="min-h-[40vh] font-mono text-xs" placeholder={t('cross_repo_import.paste_placeholder')} spellCheck={false} />
      )}

      {busy && !candidates && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          {t('cross_repo_import.loading')}
        </p>
      )}
      {error && <NoticeBanner tone="danger" title={error} />}
      {done && (
        <p className="flex items-center gap-2 text-sm">
          <CheckCircle2 size={16} className="text-primary" />
          {t('cross_repo_import.done', { imported: done.imported, updated: done.updated })}
        </p>
      )}

      {candidates && (
        <>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Download size={14} />
            {t('cross_repo_import.summary', { count: candidates.length, selected: selectable.length })}
            {candidates.some((c) => c.status === 'conflict') && <span>· {t('cross_repo_import.conflict_hint')}</span>}
          </div>
          <div className="min-h-0 flex-1">
            <DataTable
              data={rows}
              columns={columns}
              rowKey={(r) => r.key}
              selectedRowKeys={selected}
              onSelectedRowKeysChange={(keys) => setSelected(new Set([...keys].filter((k) => candidates[Number(k)]?.status !== 'up_to_date')))}
              rowClassName={(r) => (r.status === 'up_to_date' ? 'text-muted-foreground' : undefined)}
              cellTooltips="truncated"
              pageSize={50}
              viewKey="cross-repo-import"
            />
          </div>
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => setCandidates(null)}>
              {t('cross_repo_import.back')}
            </Button>
          </div>
        </>
      )}
    </DialogShell>
  )
}
