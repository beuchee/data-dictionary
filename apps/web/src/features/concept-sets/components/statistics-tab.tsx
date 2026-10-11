// Lazy-loaded (it pulls recharts): import it through React.lazy only.
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, BarChart3, Clock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { DataTable, type DataTableColumn } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { SectionLabel } from '@/components/ui/section-label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { profileView, statsProfiles, type ProfileView } from '../lib/distribution-stats'
import type { ConceptSet } from '@/lib/data'

interface StatisticsTabProps {
  conceptSet: ConceptSet
  lang: string
}

export function StatisticsTab({ conceptSet, lang }: StatisticsTabProps) {
  const { t } = useTranslation()
  const stats = conceptSet.metadata?.distributionStats ?? null
  const profiles = useMemo(() => statsProfiles(stats, lang), [stats, lang])
  const [picked, setPicked] = useState<number | null>(null)

  if (!profiles) {
    return (
      <EmptyState
        icon={BarChart3}
        title={t('concept_sets.statistics.empty_title')}
        description={t('concept_sets.statistics.empty_description')}
      />
    )
  }

  const index = picked !== null && picked < profiles.profiles.length ? picked : profiles.defaultIndex
  const view = profileView(stats, index, lang)
  const profileLabel = (p: { index: number; name: string | null }) =>
    p.name ?? t('concept_sets.statistics.profile_n', { n: p.index + 1 })

  return (
    <div className="max-w-4xl space-y-4">
      {profiles.profiles.length > 1 && (
        <div className="flex items-center gap-2">
          <SectionLabel>{t('concept_sets.statistics.profile')}</SectionLabel>
          <Select value={String(index)} onValueChange={(v) => setPicked(Number(v))}>
            <SelectTrigger size="xs" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {profiles.profiles.map((p) => (
                <SelectItem key={p.index} value={String(p.index)}>
                  {profileLabel(p)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {!view || view.empty ? (
        <EmptyState icon={BarChart3} variant="filtered" title={t('concept_sets.statistics.profile_empty')} />
      ) : (
        <ProfileDetails view={view} />
      )}
    </div>
  )
}

function ProfileDetails({ view }: { view: ProfileView }) {
  const { t, i18n } = useTranslation()
  const format = (n: number) => n.toLocaleString(i18n.language)

  return (
    <div className="space-y-5">
      {view.description && <p className="text-sm text-muted-foreground">{view.description}</p>}

      {(view.dataTypes.length > 0 || view.typicalInterval || view.missingRate !== null) && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {view.dataTypes.map((type) => (
            <Badge key={type} variant="secondary">{type}</Badge>
          ))}
          {view.typicalInterval && (
            <span className="inline-flex items-center gap-1">
              <Clock size={12} />
              {t('concept_sets.statistics.typical_interval')}{' '}
              <strong className="text-foreground">{view.typicalInterval}</strong>
            </span>
          )}
          {view.missingRate !== null && (
            <span className="inline-flex items-center gap-1">
              <AlertTriangle size={12} />
              {t('concept_sets.statistics.missing_rate')}{' '}
              <strong className="text-foreground">{format(view.missingRate)} %</strong>
            </span>
          )}
        </div>
      )}

      {view.numeric.length > 0 && (
        <section>
          <SectionLabel as="h3" className="mb-2">{t('concept_sets.statistics.numeric_summary')}</SectionLabel>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-5">
            {view.numeric.map(({ key, value }) => (
              <div key={key} className="flex items-baseline justify-between gap-2 border-b py-1 text-xs">
                <dt className="text-muted-foreground">{t(`concept_sets.statistics.numeric.${key}`)}</dt>
                <dd className="font-mono tabular-nums">
                  {format(value)}
                  {key === 'cv' ? ' %' : ''}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {view.histogram.length > 0 && (
        <section>
          <SectionLabel as="h3" className="mb-2">{t('concept_sets.statistics.distribution')}</SectionLabel>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={view.histogram} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="x" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} />
                <YAxis
                  tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  tickFormatter={(v: number) => format(v)}
                />
                <Tooltip
                  cursor={{ fill: 'var(--accent)' }}
                  formatter={(v) => [format(Number(v)), t('concept_sets.statistics.count')]}
                  contentStyle={{
                    fontSize: 12,
                    background: 'var(--popover)',
                    color: 'var(--popover-foreground)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                  }}
                />
                <Bar dataKey="count" fill="var(--primary)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {view.categorical.length > 0 && (
        <section>
          <SectionLabel as="h3" className="mb-2">{t('concept_sets.statistics.categories')}</SectionLabel>
          <CategoricalTable rows={view.categorical} format={format} />
        </section>
      )}
    </div>
  )
}

type CategoryRow = ProfileView['categorical'][number]

function CategoricalTable({ rows, format }: { rows: CategoryRow[]; format: (n: number) => string }) {
  const { t } = useTranslation()
  const maxPercent = Math.max(0, ...rows.map((r) => r.percent ?? 0))
  const columns: DataTableColumn<CategoryRow>[] = [
    { id: 'value', header: t('concept_sets.statistics.value'), accessor: (r) => r.value, size: 260 },
    { id: 'count', header: t('concept_sets.statistics.count'), accessor: (r) => r.count, display: (r) => format(r.count), size: 100, align: 'right' },
    {
      id: 'percent',
      header: t('concept_sets.statistics.percent'),
      accessor: (r) => r.percent,
      size: 220,
      cell: (r) =>
        r.percent === null ? null : (
          <div className="flex items-center gap-2">
            <div className="h-2 flex-1 rounded-sm bg-muted">
              <div
                className="h-2 rounded-sm bg-primary"
                style={{ width: `${maxPercent > 0 ? (r.percent / maxPercent) * 100 : 0}%` }}
              />
            </div>
            <span className="w-12 text-right font-mono tabular-nums">{format(r.percent)} %</span>
          </div>
        ),
    },
  ]
  return <DataTable data={rows} columns={columns} rowKey={(r) => rows.indexOf(r)} density="compact" />
}
