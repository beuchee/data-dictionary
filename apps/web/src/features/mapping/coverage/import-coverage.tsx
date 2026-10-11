import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { ArrowLeft, Check, CheckCheck, ListChecks, Loader2, Search, Target, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTable, type DataTableColumn } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { MultiSelectFilter } from '@/components/ui/multi-select-filter'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { Progress } from '@/components/ui/progress'
import { SectionLabel } from '@/components/ui/section-label'
import { StatCard } from '@/components/ui/stat-card'
import { coverageTargets, statusCounts } from '@/lib/mapping-import/coverage'
import { cn } from '@/lib/utils'
import { useCatalogStore } from '@/stores/catalog-store'
import { useMappingsStore } from '@/stores/mappings-store'
import { RuleBadge } from '@/features/projects/project-badges'
import { conceptSetHref, projectTranslation } from '@/features/projects/project-rows'
import { CoverageDetailsDialog } from './coverage-details-dialog'
import { eligibilityRows, evaluate, matchedTargets, pinnedEntries, type EligibilityRow } from './eligibility'
import type { ConceptSetSummary } from '@/lib/data'

interface ImportCoverageProps {
  importId: string
  projectId: number | null
  detail: number | null
  detailVersion: string
  onChange: (patch: Record<string, string | null>) => void
}

const NO_STATUS = ''

/** One import: its figures, the score of every project, and the per-concept-set table of the selected one. */
export function ImportCoverage({ importId, projectId, detail, detailVersion, onChange }: ImportCoverageProps) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const navigate = useNavigate()
  const detailResource = useMappingsStore((s) => s.details[importId])
  const loadImport = useMappingsStore((s) => s.loadImport)
  const resolvedIds = useMappingsStore((s) => s.resolvedIds)
  const loadResolvedIds = useMappingsStore((s) => s.loadResolvedIds)
  const projects = useCatalogStore((s) => s.projects)
  const conceptSets = useCatalogStore((s) => s.conceptSets)
  const loadProjects = useCatalogStore((s) => s.loadProjects)
  const loadConceptSets = useCatalogStore((s) => s.loadConceptSets)
  const [statuses, setStatuses] = useState<string[] | null>(null)

  useEffect(() => {
    loadImport(importId)
    loadProjects()
    loadConceptSets()
  }, [importId, loadImport, loadProjects, loadConceptSets])

  const mapping = detailResource?.data ?? null
  const summaries = useMemo(
    () => new Map<number, ConceptSetSummary>((conceptSets.data ?? []).map((c) => [c.id, c])),
    [conceptSets.data],
  )
  const currentVersion = useMemo(() => (id: number) => summaries.get(id)?.version ?? null, [summaries])
  const projectList = useMemo(() => projects.data ?? [], [projects.data])
  const entries = useMemo(() => pinnedEntries(projectList, currentVersion), [projectList, currentVersion])

  useEffect(() => {
    if (entries.length && conceptSets.status === 'ready') void loadResolvedIds(entries)
  }, [entries, conceptSets.status, loadResolvedIds])

  const statusOptions = useMemo(() => (mapping ? statusCounts(mapping.rows) : []), [mapping])
  const activeStatuses = statuses ?? mapping?.defaultStatuses ?? null
  const mapped = useMemo(() => (mapping ? coverageTargets(mapping.rows, activeStatuses) : new Set<number>()), [mapping, activeStatuses])

  const resolvedData = useMemo(() => {
    const out: Record<string, number[] | null | undefined> = {}
    for (const [k, r] of Object.entries(resolvedIds)) out[k] = r.status === 'ready' ? r.data : undefined
    return out
  }, [resolvedIds])
  const pending = entries.filter((e) => {
    const r = resolvedIds[`${e.id}@${e.version}`]
    return !r || r.status === 'loading'
  }).length

  const results = useMemo(
    () => projectList.map((p) => ({ project: p, coverage: evaluate(p, mapped, resolvedData, currentVersion) })),
    [projectList, mapped, resolvedData, currentVersion],
  )
  const selected = results.find((r) => r.project.id === projectId) ?? results[0] ?? null
  const rows = useMemo(
    () => (selected ? eligibilityRows(selected.project, selected.coverage, summaries, lang, currentVersion) : []),
    [selected, summaries, lang, currentVersion],
  )

  if (!detailResource || detailResource.status === 'loading' || detailResource.status === 'idle') {
    return (
      <div className="flex justify-center py-12">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (detailResource.status === 'error' || !mapping) {
    return (
      <div className="flex flex-col gap-4">
        <BackButton onClick={() => onChange({ import: null, project: null, detail: null, version: null })} />
        <NoticeBanner tone="danger" title={t('coverage.import_not_found')} description={detailResource.error} />
      </div>
    )
  }

  const eligibleCount = results.filter((r) => r.coverage.eligible).length
  const statusLabel = (s: string) => (s === NO_STATUS ? t('coverage.no_status') : s)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <BackButton onClick={() => onChange({ import: null, project: null, detail: null, version: null })} />
        <h2 className="text-sm font-semibold">{mapping.name}</h2>
        <Badge variant="outline">{t(`coverage.formats.${mapping.format}`)}</Badge>
        <span className="text-xs text-muted-foreground">{mapping.sourceFileName}</span>
        {statusOptions.some(([s]) => s !== NO_STATUS) && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{t('coverage.statuses_counted')}</span>
            <MultiSelectFilter
              value={activeStatuses ?? []}
              options={statusOptions.filter(([s]) => s !== NO_STATUS).map(([s, n]) => ({ value: s, label: `${statusLabel(s)} (${n})` }))}
              placeholder={t('coverage.all_statuses')}
              onChange={(next) => setStatuses(next.length ? next : null)}
            />
          </div>
        )}
      </div>
      {mapping.description && <p className="text-sm text-muted-foreground">{mapping.description}</p>}

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          icon={<ListChecks size={16} />}
          iconBg="bg-primary/10 text-primary"
          value={mapped.size.toLocaleString()}
          label={t('coverage.stat_mapped')}
          detail={t('coverage.stat_rows', { count: mapping.rows.length })}
        />
        <StatCard
          icon={<Target size={16} />}
          iconBg="bg-sky-500/10 text-sky-700 dark:text-sky-400"
          value={matchedTargets(mapped, resolvedData).toLocaleString()}
          label={t('coverage.stat_matched')}
        />
        <StatCard
          icon={<CheckCheck size={16} />}
          iconBg="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          value={`${eligibleCount} / ${results.length}`}
          label={t('coverage.stat_eligible')}
        />
      </div>

      {pending > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t('coverage.loading_resolved', { count: pending })}</span>
          <Progress value={entries.length ? ((entries.length - pending) / entries.length) * 100 : 0} />
        </div>
      )}

      {results.length === 0 ? (
        <EmptyState icon={ListChecks} title={t('coverage.no_projects')} className="mt-4" />
      ) : (
        <>
          <section>
            <SectionLabel as="h3" className="mb-2">
              {t('coverage.per_project')}
            </SectionLabel>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {results.map(({ project, coverage }) => {
                const tr = projectTranslation(project, lang)
                const total = coverage.groups.reduce((n, g) => n + g.total, 0)
                const covered = coverage.groups.reduce((n, g) => n + g.coveredCount, 0)
                const active = selected?.project.id === project.id
                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => onChange({ project: String(project.id), detail: null, version: null })}
                    className={cn(
                      'flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors hover:bg-accent',
                      active && 'border-primary ring-1 ring-primary',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{tr.name || `#${project.id}`}</span>
                      <span
                        className={cn(
                          'text-sm font-bold tabular-nums',
                          coverage.score === 100
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : coverage.score >= 75
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-destructive',
                        )}
                      >
                        {coverage.score}%
                      </span>
                    </div>
                    <Progress value={coverage.score} />
                    <span className="text-xs text-muted-foreground">
                      {t('coverage.sets_covered', { covered, total })}
                      {coverage.eligible && ` · ${t('coverage.eligible')}`}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          {selected && (
            <section>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <SectionLabel as="h3">
                  {t('coverage.eligibility_of', { name: projectTranslation(selected.project, lang).name || `#${selected.project.id}` })}
                </SectionLabel>
                <span className="ml-auto text-xs text-muted-foreground">
                  {t('coverage.summary_line', {
                    covered: rows.filter((r) => r.covered).length,
                    total: rows.length,
                    score: selected.coverage.score,
                  })}
                </span>
              </div>
              <EligibilityTable
                rows={rows}
                onOpen={(r) => navigate(conceptSetHref(r.conceptSetId, r.version))}
                onDetails={(r) => onChange({ detail: String(r.conceptSetId), version: r.version || null })}
              />
            </section>
          )}
        </>
      )}

      {detail !== null && (
        <CoverageDetailsDialog
          conceptSetId={detail}
          version={detailVersion}
          name={summaries.get(detail)?.translations[lang]?.name ?? null}
          rows={mapping.rows}
          statuses={activeStatuses}
          onClose={() => onChange({ detail: null, version: null })}
        />
      )}
    </div>
  )
}

function BackButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation()
  return (
    <Button variant="ghost" size="sm" onClick={onClick}>
      <ArrowLeft size={14} />
      {t('coverage.back')}
    </Button>
  )
}

interface EligibilityTableProps {
  rows: EligibilityRow[]
  onOpen: (row: EligibilityRow) => void
  onDetails: (row: EligibilityRow) => void
}

function EligibilityTable({ rows, onOpen, onDetails }: EligibilityTableProps) {
  const { t } = useTranslation()
  const columns = useMemo<DataTableColumn<EligibilityRow>[]>(
    () => [
      {
        id: 'group',
        header: t('coverage.group'),
        accessor: (r) => r.groupName ?? '',
        filter: 'select',
      },
      {
        id: 'rule',
        header: t('coverage.rule'),
        accessor: (r) => r.rule,
        filter: 'select',
        selectOptionLabel: (v) => t(`projects.rule.${v}`),
        cell: (r) => <RuleBadge rule={r.rule} />,
      },
      {
        id: 'name',
        header: t('coverage.concept_set'),
        accessor: (r) => r.name ?? `#${r.conceptSetId}`,
        filter: 'text',
      },
      { id: 'version', header: t('coverage.version'), accessor: (r) => r.version, hidden: true },
      {
        id: 'resolved',
        header: t('coverage.resolved'),
        accessor: (r) => (r.available ? r.resolved : null),
        display: (r) => (r.available ? String(r.resolved) : '—'),
        align: 'right',
      },
      {
        id: 'status',
        header: t('coverage.status'),
        accessor: (r) => (r.covered ? 'covered' : 'not_covered'),
        filter: 'select',
        selectOptionLabel: (v) => t(`coverage.${v}`),
        cell: (r) =>
          r.covered ? (
            <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
              <Check />
              {t('coverage.covered')}
            </Badge>
          ) : (
            <Badge className="bg-destructive/10 text-destructive">
              <X />
              {r.available ? t('coverage.not_covered') : t('coverage.unavailable')}
            </Badge>
          ),
      },
      {
        id: 'details',
        header: '',
        accessor: () => null,
        sortable: false,
        size: 48,
        cell: (r) => (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('coverage.details')}
            onClick={(e) => {
              e.stopPropagation()
              onDetails(r)
            }}
          >
            <Search size={12} />
          </Button>
        ),
      },
    ],
    [t, onDetails],
  )
  return (
    <DataTable
      data={rows}
      columns={columns}
      rowKey={(r) => r.key}
      onRowClick={onOpen}
      pageSize={100}
      density="compact"
      emptyMessage={t('coverage.no_concept_sets')}
    />
  )
}
