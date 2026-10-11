import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Library, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DataTable, type DataTableColumn } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { TruncatedText } from '@/components/ui/truncated-text'
import { ReviewStatusBadge, RuleBadge, VersionStatusBadge } from './project-badges'
import { conceptSetHref, projectSections, type ProjectConceptSetRow, type ProjectGroupSection } from './project-rows'
import type { ConceptSetSummary, Project } from '@/lib/data'

interface ProjectConceptSetsProps {
  project: Project
  summaries: ReadonlyMap<number, ConceptSetSummary>
  lang: string
  /** Moves one outdated pin to the current version; absent = read-only. */
  onUpdate?: (row: ProjectConceptSetRow) => void
  /** Moves every outdated pin. */
  onUpdateAll?: (rows: ProjectConceptSetRow[]) => void
}

/** The concept sets of a project, one table per group, each set at its pinned version. */
export function ProjectConceptSets({ project, summaries, lang, onUpdate, onUpdateAll }: ProjectConceptSetsProps) {
  const { t } = useTranslation()
  const sections = useMemo(() => projectSections(project, summaries, lang), [project, summaries, lang])

  if (sections.every((s) => s.rows.length === 0) && sections.length <= 1) {
    return <EmptyState icon={Library} title={t('projects.no_concept_sets')} className="mt-4" />
  }

  const outdated = sections.flatMap((s) => s.rows).filter((r) => r.versionStatus === 'outdated')

  return (
    <div className="flex flex-col gap-8">
      {onUpdateAll && outdated.length > 0 && (
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onUpdateAll(outdated)}>
            <RefreshCw size={14} />
            {t('projects.update.update_all', { count: outdated.length })}
          </Button>
        </div>
      )}
      {sections.map((section) => (
        <GroupSection key={section.id} section={section} onUpdate={onUpdate} />
      ))}
    </div>
  )
}

function GroupSection({ section, onUpdate }: { section: ProjectGroupSection; onUpdate?: (row: ProjectConceptSetRow) => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const base = useConceptSetColumns()
  const columns: DataTableColumn<ProjectConceptSetRow>[] = onUpdate
    ? [
        ...base,
        {
          id: 'update',
          header: '',
          accessor: () => '',
          sortable: false,
          size: 90,
          cell: (r) =>
            r.versionStatus === 'outdated' ? (
              <Button
                variant="outline"
                size="xs"
                onClick={(e) => {
                  e.stopPropagation()
                  onUpdate(r)
                }}
              >
                {t('projects.update.update')}
              </Button>
            ) : null,
        },
      ]
    : base
  const title = section.isDefault && !section.name ? t('projects.default_group') : section.name

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2 className={title ? 'text-sm font-semibold text-foreground' : 'text-sm italic text-muted-foreground'}>
          {title ?? t('projects.unnamed_group')}
        </h2>
        <RuleBadge rule={section.rule} />
        <span className="text-xs text-muted-foreground">
          {t('projects.n_concept_sets', { count: section.rows.length })}
        </span>
      </div>
      <DataTable
        data={section.rows}
        columns={columns}
        rowKey={(r) => r.key}
        onRowClick={(r) => navigate(conceptSetHref(r.id, r.pinnedVersion))}
        emptyMessage={t('projects.group_empty')}
        pageSize={100}
        density="compact"
      />
    </section>
  )
}

function useConceptSetColumns(): DataTableColumn<ProjectConceptSetRow>[] {
  const { t } = useTranslation()
  return useMemo(
    () => [
      { id: 'id', header: t('projects.col.id'), accessor: (r) => r.id, filter: 'number', size: 70, align: 'right', hidden: true },
      {
        id: 'name',
        header: t('projects.col.name'),
        accessor: (r) => r.name,
        filter: 'text',
        size: 280,
        cell: (r) =>
          r.name ? (
            <TruncatedText text={r.name} readOnly className="font-medium" />
          ) : (
            <span className="italic text-muted-foreground">
              {r.currentVersion === null ? t('projects.unknown_concept_set', { id: r.id }) : t('projects.no_name')}
            </span>
          ),
      },
      { id: 'category', header: t('projects.col.category'), accessor: (r) => r.category, filter: 'select', size: 160 },
      { id: 'subcategory', header: t('projects.col.subcategory'), accessor: (r) => r.subcategory, filter: 'select', size: 160 },
      {
        id: 'description',
        header: t('projects.col.description'),
        accessor: (r) => r.shortDescription,
        filter: 'text',
        size: 260,
        hidden: true,
      },
      {
        id: 'status',
        header: t('projects.col.status'),
        accessor: (r) => r.reviewStatus,
        filter: 'select',
        selectOptionLabel: (v) => t(`projects.review_status.${v}`),
        cell: (r) => <ReviewStatusBadge status={r.reviewStatus} />,
        size: 140,
      },
      {
        id: 'pinned',
        header: t('projects.col.pinned_version'),
        accessor: (r) => r.pinnedVersion,
        filter: 'text',
        cellClassName: 'font-mono',
        size: 120,
      },
      {
        id: 'current',
        header: t('projects.col.current_version'),
        accessor: (r) => r.currentVersion,
        filter: 'text',
        cellClassName: 'font-mono',
        size: 120,
      },
      {
        id: 'versionStatus',
        header: t('projects.col.version_status'),
        accessor: (r) => r.versionStatus,
        filter: 'select',
        selectOptionLabel: (v) => t(`projects.version_status.${v}`),
        cell: (r) => <VersionStatusBadge status={r.versionStatus} pinned={r.pinnedVersion} current={r.currentVersion} />,
        size: 130,
      },
    ],
    [t],
  )
}
