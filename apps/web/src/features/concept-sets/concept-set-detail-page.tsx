import { Suspense, lazy, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams, useSearchParams } from 'react-router'
import { BarChart3, ChevronRight, ClipboardCheck, Code, History, List, Loader2, MessageSquareText, SearchX } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { PageContainer, PageHeader } from '@/components/ui/page-header'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { conceptSetKey, useCatalogStore } from '@/stores/catalog-store'
import { normalizeOrganization } from '@/lib/data/catalog'
import { StatusBadge } from './components/badges'
import { CommentsTab } from './components/comments-tab'
import { ConceptsTab, type ConceptsView } from './components/concepts-tab'
import { JsonViewerDialog } from './components/json-viewer-dialog'
import { ReviewsTab } from './components/reviews-tab'
import { VersionHistoryDialog } from './components/version-history-dialog'
import { isReachable, listPath, parseDetailTab, useContentLanguage, type DetailTab } from './lib/navigation'
import type { ConceptSet, VersionInfo } from '@/lib/data'

// recharts weighs ~100 kB gzipped: only fetched when the Statistics tab opens.
const StatisticsTab = lazy(() => import('./components/statistics-tab').then((m) => ({ default: m.StatisticsTab })))

const TAB_ICONS = { concepts: List, comments: MessageSquareText, statistics: BarChart3, reviews: ClipboardCheck }

export function ConceptSetDetailPage() {
  const { t } = useTranslation()
  const { id: rawId } = useParams()
  const id = /^\d+$/.test(rawId ?? '') ? Number(rawId) : null
  const [searchParams, setSearchParams] = useSearchParams()
  const version = searchParams.get('version') || undefined
  const tab = parseDetailTab(searchParams.get('tab'))
  const view: ConceptsView = searchParams.get('view') === 'expression' ? 'expression' : 'resolved'

  const loadConceptSet = useCatalogStore((s) => s.loadConceptSet)
  const loadVersions = useCatalogStore((s) => s.loadConceptSetVersions)
  const resource = useCatalogStore((s) => (id === null ? undefined : s.conceptSetDetails[conceptSetKey(id, version)]))
  const versions = useCatalogStore((s) => (id === null ? undefined : s.conceptSetVersions[String(id)]))

  useEffect(() => {
    if (id !== null) void loadConceptSet(id, version)
  }, [id, version, loadConceptSet])

  useEffect(() => {
    if (id !== null) void loadVersions(id)
  }, [id, loadVersions])

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams)
    if (value === null) next.delete(key)
    else next.set(key, value)
    setSearchParams(next, { replace: key !== 'version' })
  }

  const breadcrumb = (current: string) => (
    <nav aria-label={t('concept_sets.detail.breadcrumb')} className="flex items-center gap-1 text-xs text-muted-foreground">
      <Link to={listPath()} className="hover:text-foreground hover:underline">
        {t('concept_sets.title')}
      </Link>
      <ChevronRight size={12} aria-hidden />
      <span className="truncate text-foreground">{current}</span>
    </nav>
  )

  if (id === null || (resource?.status === 'ready' && !resource.data)) {
    const unknownVersion = id !== null && version
    return (
      <PageContainer width="wide">
        {breadcrumb(rawId ?? '')}
        <EmptyState
          icon={SearchX}
          className="mt-8"
          title={unknownVersion ? t('concept_sets.detail.version_not_found', { version }) : t('concept_sets.detail.not_found', { id: rawId })}
          action={
            unknownVersion ? (
              <Button variant="outline" onClick={() => setParam('version', null)}>
                {t('concept_sets.detail.view_current')}
              </Button>
            ) : (
              <Button variant="outline" asChild>
                <Link to={listPath()}>{t('concept_sets.detail.back_to_list')}</Link>
              </Button>
            )
          }
        />
      </PageContainer>
    )
  }

  if (resource?.status === 'error') {
    return (
      <PageContainer width="wide">
        {breadcrumb(`#${id}`)}
        <NoticeBanner
          tone="danger"
          className="mt-6"
          title={t('concept_sets.detail.load_error')}
          description={resource.error}
          action={
            <Button variant="outline" size="xs" onClick={() => void loadConceptSet(id, version)}>
              {t('concept_sets.retry')}
            </Button>
          }
        />
      </PageContainer>
    )
  }

  const conceptSet = resource?.data
  if (!conceptSet) {
    return (
      <PageContainer width="wide">
        {breadcrumb(`#${id}`)}
        <Skeleton className="mt-4 h-8 w-80" />
        <Skeleton className="mt-3 h-4 w-[32rem]" />
        <Skeleton className="mt-8 h-9 w-96" />
        <div className="mt-4 space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      </PageContainer>
    )
  }

  return (
    <ConceptSetDetail
      conceptSet={conceptSet}
      requestedVersion={version}
      versions={versions?.data?.versions ?? null}
      versionsLoading={versions?.status === 'loading'}
      currentVersion={versions?.data?.currentVersion ?? null}
      tab={tab}
      view={view}
      breadcrumb={breadcrumb}
      setParam={setParam}
    />
  )
}

interface ConceptSetDetailProps {
  conceptSet: ConceptSet
  requestedVersion: string | undefined
  versions: VersionInfo[] | null
  versionsLoading: boolean
  currentVersion: string | null
  tab: DetailTab
  view: ConceptsView
  breadcrumb: (current: string) => React.ReactNode
  setParam: (key: string, value: string | null) => void
}

function ConceptSetDetail({
  conceptSet,
  requestedVersion,
  versions,
  versionsLoading,
  currentVersion,
  tab,
  view,
  breadcrumb,
  setParam,
}: ConceptSetDetailProps) {
  const { t } = useTranslation()
  const lang = useContentLanguage()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [jsonOpen, setJsonOpen] = useState(false)

  const translations = conceptSet.metadata?.translations ?? {}
  const translation = Object.hasOwn(translations, lang) ? translations[lang] : undefined
  const name = translation?.name || ''
  const title = name || t('concept_sets.detail.untitled', { id: conceptSet.id })
  const organization = normalizeOrganization(conceptSet.metadata?.organization)
  const pastVersion = requestedVersion !== undefined && currentVersion !== null && requestedVersion !== currentVersion
  const shownVersion = conceptSet.version

  const pickVersion = (v: VersionInfo) => {
    setParam('version', v.isCurrent ? null : v.version)
    setHistoryOpen(false)
  }

  const versionOptions = versions ?? [{ version: shownVersion, isCurrent: !pastVersion, commit: null, date: null, author: null, message: null }]

  return (
    <PageContainer width="wide">
      <PageHeader
        above={breadcrumb(name || `#${conceptSet.id}`)}
        title={<span className={name ? undefined : 'text-muted-foreground italic'}>{title}</span>}
        description={translation?.shortDescription || undefined}
        actions={
          <>
            {/* TODO(concept-sets-export): the Export menu (INDICATE JSON, ATLAS JSON, SQL) goes here.
                TODO(concept-sets-edit): the Edit button goes here. */}
            <Button variant="outline" onClick={() => setJsonOpen(true)}>
              <Code size={14} />
              {t('concept_sets.detail.view_json')}
            </Button>
          </>
        }
      />

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <StatusBadge status={conceptSet.metadata?.reviewStatus} />
        <div className="flex items-center gap-1">
          <Select value={shownVersion} onValueChange={(v) => {
            const picked = versionOptions.find((o) => o.version === v)
            if (picked) pickVersion(picked)
          }}>
            <SelectTrigger size="xs" className="min-w-28" aria-label={t('concept_sets.columns.version')}>
              <SelectValue>v{shownVersion}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {versionOptions.map((v) => (
                <SelectItem key={v.version} value={v.version} disabled={!isReachable(v)}>
                  v{v.version}
                  {v.isCurrent ? ` · ${t('concept_sets.versions.current')}` : ''}
                  {!isReachable(v) ? ` · ${t('concept_sets.versions.unavailable')}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {versionsLoading && <Loader2 size={12} className="animate-spin" />}
          <Button variant="ghost" size="icon-xs" onClick={() => setHistoryOpen(true)} aria-label={t('concept_sets.versions.title')} title={t('concept_sets.versions.title')}>
            <History />
          </Button>
        </div>
        {organization?.current?.name && (
          <span>
            {t('concept_sets.detail.organization')}{' '}
            {organization.current.url ? (
              <a href={organization.current.url} target="_blank" rel="noopener noreferrer" className="text-foreground hover:underline">
                {organization.current.name}
              </a>
            ) : (
              <span className="text-foreground">{organization.current.name}</span>
            )}
            {organization.created?.name && organization.created.name !== organization.current.name && (
              <> · {t('concept_sets.detail.created_by_org', { name: organization.created.name })}</>
            )}
          </span>
        )}
        {(conceptSet.createdBy || conceptSet.createdDate) && (
          <span>{t('concept_sets.detail.created', { who: conceptSet.createdBy || '—', date: conceptSet.createdDate || '—' })}</span>
        )}
        {(conceptSet.modifiedBy || conceptSet.modifiedDate) && (
          <span>{t('concept_sets.detail.modified', { who: conceptSet.modifiedBy || '—', date: conceptSet.modifiedDate || '—' })}</span>
        )}
        {translation?.category && (
          <Badge variant="outline">
            {translation.category}
            {translation.subcategory ? ` / ${translation.subcategory}` : ''}
          </Badge>
        )}
      </div>

      {pastVersion && (
        <NoticeBanner
          tone="warning"
          className="mt-4"
          title={t('concept_sets.detail.past_version_title', { version: shownVersion })}
          description={t('concept_sets.detail.past_version_description', { current: currentVersion })}
          action={
            <Button variant="outline" size="xs" onClick={() => setParam('version', null)}>
              {t('concept_sets.detail.view_current')}
            </Button>
          }
        />
      )}

      <Tabs value={tab} onValueChange={(v) => setParam('tab', v === 'concepts' ? null : v)} className="mt-6">
        <TabsList variant="line" className="w-full justify-start border-b">
          {(['concepts', 'comments', 'statistics', 'reviews'] as const).map((key) => {
            const Icon = TAB_ICONS[key]
            const count = key === 'reviews' ? (conceptSet.metadata?.reviews?.length ?? 0) : null
            return (
              <TabsTrigger key={key} value={key} className="flex-none px-3 text-xs">
                <Icon size={14} />
                {t(`concept_sets.tabs.${key}`)}
                {count ? <Badge variant="secondary" size="xs">{count}</Badge> : null}
              </TabsTrigger>
            )
          })}
        </TabsList>
        <TabsContent value="concepts" className="mt-4">
          <ConceptsTab
            conceptSet={conceptSet}
            version={pastVersion ? shownVersion : undefined}
            view={view}
            onViewChange={(v) => setParam('view', v === 'resolved' ? null : v)}
          />
        </TabsContent>
        <TabsContent value="comments" className="mt-4">
          <CommentsTab conceptSet={conceptSet} lang={lang} />
        </TabsContent>
        <TabsContent value="statistics" className="mt-4">
          <Suspense fallback={<Loader2 size={14} className="animate-spin text-muted-foreground" />}>
            <StatisticsTab conceptSet={conceptSet} lang={lang} />
          </Suspense>
        </TabsContent>
        <TabsContent value="reviews" className="mt-4">
          <ReviewsTab conceptSet={conceptSet} />
        </TabsContent>
      </Tabs>

      <VersionHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        versions={versions ?? []}
        shownVersion={shownVersion}
        onPick={pickVersion}
      />
      <JsonViewerDialog open={jsonOpen} onOpenChange={setJsonOpen} conceptSet={conceptSet} />
    </PageContainer>
  )
}
