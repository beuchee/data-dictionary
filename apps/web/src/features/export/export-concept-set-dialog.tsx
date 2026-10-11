import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { DialogShell } from '@/components/ui/dialog-shell'
import { Label } from '@/components/ui/label'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { repositoryConfig, repositoryUrl } from '@/lib/data/forge'
import {
  availableReferenceUnitIds,
  buildAtlasJson,
  buildIndicateJson,
  buildOmopSql,
  conceptSetDisplayName,
  downloadText,
  pickDefaultReferenceUnitId,
  referenceUnitOptions,
  unitLabelsFromOptions,
  type UnitVocabEntry,
} from '@/lib/export'
import { useAuthStore } from '@/stores/auth-store'
import { useConfigStore } from '@/stores/config-store'
import { CodePreview, type PreviewLanguage } from './code-preview'
import { CopyExportButton } from './copy-export-button'
import { defaultToolTag, readDropOtherUnits, today, writeDropOtherUnits } from './export-settings'
import type { ConceptSet, RecommendedUnit, ResolvedConcept, UnitConversion } from '@data-dictionary/format'

export type ConceptSetExportFormat = 'indicate' | 'atlas' | 'sql'

export interface ExportConceptSetDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The set as shown, at the version shown (a pinned past version exports that version). */
  conceptSet: ConceptSet
  /**
   * The resolved concepts of that same version, all of them (no paging). Called
   * once per set and version when the SQL tab opens; null when it has none.
   */
  loadResolved: () => Promise<ResolvedConcept[] | null>
  recommendedUnits: readonly RecommendedUnit[]
  unitConversions: readonly UnitConversion[]
  /** Unit codes and names from the loaded OHDSI vocabulary, when there is one. */
  unitVocabulary?: ReadonlyMap<number, UnitVocabEntry>
  /** Content language for the set's name in the SQL header. Default: the UI language. */
  lang?: string
  /** Tab open at first. Default: INDICATE JSON. */
  defaultFormat?: ConceptSetExportFormat
  /** Link back to the set printed in the SQL. Default: this app's URL for the set and version. */
  permalink?: string
  /** `createdByTool` and SQL header tag. Default: this app and its version (see `toolTag`). */
  toolTag?: string
  /** `modifiedBy` stamped on the INDICATE JSON. Default: the signed-in user's name, if any. */
  modifiedBy?: string | null
}

type ResolvedState =
  | { key: string; status: 'ready'; concepts: ResolvedConcept[] }
  | { key: string; status: 'error' }

const FORMATS: { id: ConceptSetExportFormat; labelKey: string; language: PreviewLanguage }[] = [
  { id: 'indicate', labelKey: 'export.format_indicate', language: 'json' },
  { id: 'atlas', labelKey: 'export.format_atlas', language: 'json' },
  { id: 'sql', labelKey: 'export.format_sql', language: 'sql' },
]

// TODO(v2-routes): align with the concept set detail route once the page exists.
function defaultPermalink(cs: ConceptSet): string {
  const base = `${window.location.origin}${import.meta.env.BASE_URL}`
  const version = cs.version ? `&version=${encodeURIComponent(cs.version)}` : ''
  return `${base}concept-sets?id=${cs.id}${version}`
}

/**
 * Export of one concept set as INDICATE JSON (the repository file), ATLAS JSON
 * (expression only) or OMOP SQL (reference unit picker, unit conversions,
 * optional drop of rows in other units), each previewed, copied or downloaded.
 */
export function ExportConceptSetDialog({
  open,
  onOpenChange,
  conceptSet,
  loadResolved,
  recommendedUnits,
  unitConversions,
  unitVocabulary,
  lang,
  defaultFormat = 'indicate',
  permalink,
  toolTag,
  modifiedBy,
}: ExportConceptSetDialogProps) {
  const { t, i18n } = useTranslation()
  const config = useConfigStore((s) => s.config)
  const server = useConfigStore((s) => s.server)
  const user = useAuthStore((s) => s.user)
  const [format, setFormat] = useState<ConceptSetExportFormat>(defaultFormat)
  const [resolved, setResolved] = useState<ResolvedState | null>(null)
  const [unitChoice, setUnitChoice] = useState<{ key: string; unitId: number } | null>(null)
  const [dropOtherUnits, setDropOtherUnits] = useState(readDropOtherUnits)
  const [date] = useState(today)
  const loaderRef = useRef(loadResolved)

  const key = `${conceptSet.id}@${conceptSet.version}`
  const contentLang = lang ?? i18n.language
  const tag = toolTag ?? defaultToolTag(server?.appVersion)
  const userName = [user?.first_name, user?.last_name].filter(Boolean).join(' ')
  const repoUrl = config ? repositoryUrl(repositoryConfig(config)) : ''
  const needsResolved = open && format === 'sql'
  const resolvedReady = resolved?.key === key && resolved.status === 'ready' ? resolved.concepts : null
  const resolvedFailed = resolved?.key === key && resolved.status === 'error'

  useEffect(() => {
    loaderRef.current = loadResolved
  }, [loadResolved])

  useEffect(() => {
    if (!needsResolved || resolved?.key === key) return
    let cancelled = false
    loaderRef.current()
      .then((concepts) => {
        if (!cancelled) setResolved({ key, status: 'ready', concepts: concepts ?? [] })
      })
      .catch((err: unknown) => {
        console.error(`Could not load the resolved concepts of concept set ${key}`, err)
        if (!cancelled) setResolved({ key, status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [needsResolved, key, resolved?.key])

  const unitOptions = useMemo(() => {
    if (!resolvedReady) return []
    const ids = availableReferenceUnitIds(resolvedReady, recommendedUnits, unitConversions)
    return referenceUnitOptions(ids, recommendedUnits, unitConversions, unitVocabulary)
  }, [resolvedReady, recommendedUnits, unitConversions, unitVocabulary])

  const defaultUnitId = useMemo(
    () => (resolvedReady ? pickDefaultReferenceUnitId(unitOptions.map((o) => o.unitId), resolvedReady, recommendedUnits) : null),
    [resolvedReady, unitOptions, recommendedUnits],
  )
  const referenceUnitId = unitChoice?.key === key && unitOptions.some((o) => o.unitId === unitChoice.unitId)
    ? unitChoice.unitId
    : defaultUnitId

  const content = useMemo(() => {
    if (!open) return null
    if (format === 'indicate') {
      return buildIndicateJson(conceptSet, { toolTag: tag, date, modifiedBy: modifiedBy ?? userName, repoUrl })
    }
    if (format === 'atlas') return buildAtlasJson(conceptSet)
    if (!resolvedReady) return null
    return buildOmopSql({
      conceptSet,
      resolved: resolvedReady,
      unitConversions,
      recommendedUnits,
      referenceUnitId,
      dropOtherUnits,
      unitLabels: unitLabelsFromOptions(unitOptions),
      lang: contentLang,
      permalink: permalink ?? defaultPermalink(conceptSet),
      toolTag: tag,
      date,
    })
  }, [open, format, conceptSet, tag, date, modifiedBy, userName, repoUrl, resolvedReady, unitConversions,
    recommendedUnits, referenceUnitId, dropOtherUnits, unitOptions, contentLang, permalink])

  const handleDropChange = (on: boolean) => {
    setDropOtherUnits(on)
    writeDropOtherUnits(on)
  }

  const handleDownload = () => {
    if (content === null) return
    const id = conceptSet.id
    if (format === 'sql') downloadText(`${id}.sql`, content, 'application/sql')
    else downloadText(format === 'atlas' ? `${id}-atlas.json` : `${id}.json`, content, 'application/json')
  }

  const language = FORMATS.find((f) => f.id === format)!.language
  const name = conceptSetDisplayName(conceptSet, contentLang)

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      kind="workbench"
      title={t('export.concept_set_title')}
      description={conceptSet.version ? t('export.concept_set_description', { name, version: conceptSet.version }) : name}
      onConfirm={handleDownload}
      confirmLabel={t('export.download')}
      confirmDisabled={content === null}
      hideCancel
      footerExtra={<CopyExportButton getText={() => content ?? ''} disabled={content === null} />}
      noEnterSubmit
      contentClassName="flex flex-col gap-3"
    >
      <Tabs value={format} onValueChange={(v) => setFormat(v as ConceptSetExportFormat)}>
        <TabsList className="w-full">
          {FORMATS.map((f) => (
            <TabsTrigger key={f.id} value={f.id} className="flex-1">{t(f.labelKey)}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <p className="text-xs text-muted-foreground">{t(`export.format_${format}_hint`)}</p>

      {format === 'sql' && resolvedReady && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="export-sql-unit">{t('export.reference_unit')}</Label>
            {unitOptions.length > 0 ? (
              <Select
                value={referenceUnitId === null ? undefined : String(referenceUnitId)}
                onValueChange={(v) => setUnitChoice({ key, unitId: Number(v) })}
              >
                <SelectTrigger id="export-sql-unit" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {unitOptions.map((o) => (
                    <SelectItem key={o.unitId} value={String(o.unitId)} title={o.name || o.code}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="text-xs text-muted-foreground">{t('export.no_reference_unit')}</span>
            )}
          </div>
          {referenceUnitId !== null && (
            <div className="flex items-center gap-2">
              <Switch id="export-sql-drop" checked={dropOtherUnits} onCheckedChange={handleDropChange} />
              <Label htmlFor="export-sql-drop">{t('export.drop_other_units')}</Label>
            </div>
          )}
        </div>
      )}

      {format === 'sql' && resolvedFailed && (
        <NoticeBanner
          tone="danger"
          title={t('export.resolved_failed')}
          description={t('export.resolved_failed_hint')}
        />
      )}

      {content !== null ? (
        <CodePreview text={content} language={language} className="min-h-0 flex-1" />
      ) : !resolvedFailed ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          {t('export.loading_resolved')}
        </div>
      ) : null}
    </DialogShell>
  )
}
