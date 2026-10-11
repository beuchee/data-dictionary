import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { DialogShell } from '@/components/ui/dialog-shell'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  buildProjectCsv,
  buildProjectJson,
  downloadText,
  pinnedConceptSets,
  projectCsvFilename,
} from '@/lib/export'
import { CodePreview } from './code-preview'
import { CopyExportButton } from './copy-export-button'
import type { ConceptSet, Project } from '@data-dictionary/format'

export type ProjectExportFormat = 'csv' | 'json'

export interface ExportProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project
  /**
   * A concept set at a pinned version (`version` undefined = the current one),
   * null when unknown. Called once per pinned set when the CSV tab opens.
   */
  loadConceptSet: (id: number, version: string | undefined) => Promise<ConceptSet | null>
  /** Content language of the names in the CSV. Default: the UI language. */
  lang?: string
  /** Tab open at first. Default: CSV. */
  defaultFormat?: ProjectExportFormat
}

type PinnedState = { key: string; byPin: Map<string, ConceptSet | null> }

const pinKey = (id: number, version: string | undefined) => `${id}@${version ?? ''}`

/**
 * Export of a project as CSV (one row per expression item of every concept set
 * it pins, at the pinned version) or as its JSON file, previewed, copied or
 * downloaded.
 */
export function ExportProjectDialog({
  open,
  onOpenChange,
  project,
  loadConceptSet,
  lang,
  defaultFormat = 'csv',
}: ExportProjectDialogProps) {
  const { t, i18n } = useTranslation()
  const [format, setFormat] = useState<ProjectExportFormat>(defaultFormat)
  const [pinned, setPinned] = useState<PinnedState | null>(null)
  const loaderRef = useRef(loadConceptSet)
  const contentLang = lang ?? i18n.language

  const pins = useMemo(() => {
    const seen = new Map<string, { id: number; version: string | undefined }>()
    for (const e of pinnedConceptSets(project)) {
      const version = e.version || undefined
      seen.set(pinKey(e.id, version), { id: e.id, version })
    }
    return [...seen.values()]
  }, [project])
  const key = `${project.id}:${pins.map((p) => pinKey(p.id, p.version)).join(',')}`
  const byPin = pinned?.key === key ? pinned.byPin : null

  useEffect(() => {
    loaderRef.current = loadConceptSet
  }, [loadConceptSet])

  useEffect(() => {
    if (!open || format !== 'csv' || pinned?.key === key) return
    let cancelled = false
    void Promise.all(pins.map(async (p) => {
      try {
        return [pinKey(p.id, p.version), await loaderRef.current(p.id, p.version)] as const
      } catch (err) {
        console.error(`Could not load concept set ${p.id} v${p.version ?? 'current'}`, err)
        return [pinKey(p.id, p.version), null] as const
      }
    })).then((entries) => {
      if (!cancelled) setPinned({ key, byPin: new Map(entries) })
    })
    return () => {
      cancelled = true
    }
  }, [open, format, key, pins, pinned?.key])

  const missing = useMemo(
    () => (byPin ? pins.filter((p) => !byPin.get(pinKey(p.id, p.version))) : []),
    [byPin, pins],
  )

  const content = useMemo(() => {
    if (!open) return null
    if (format === 'json') return buildProjectJson(project)
    if (!byPin) return null
    return buildProjectCsv(project, (id, version) => byPin.get(pinKey(id, version)) ?? null, contentLang)
  }, [open, format, project, byPin, contentLang])

  const handleDownload = () => {
    if (content === null) return
    if (format === 'csv') downloadText(projectCsvFilename(project, contentLang), content, 'text/csv;charset=utf-8')
    else downloadText(`${project.id}.json`, content, 'application/json')
  }

  const projectName = project.translations?.[contentLang]?.name || project.translations?.en?.name || `#${project.id}`

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      kind="workbench"
      title={t('export.project_title')}
      description={projectName}
      onConfirm={handleDownload}
      confirmLabel={t('export.download')}
      confirmDisabled={content === null}
      hideCancel
      // The BOM only helps a spreadsheet opening the file; pasted text does without it.
      footerExtra={<CopyExportButton getText={() => (content ?? '').replace(/^\uFEFF/, '')} disabled={content === null} />}
      noEnterSubmit
      contentClassName="flex flex-col gap-3"
    >
      <Tabs value={format} onValueChange={(v) => setFormat(v as ProjectExportFormat)}>
        <TabsList className="w-full">
          <TabsTrigger value="csv" className="flex-1">{t('export.format_csv')}</TabsTrigger>
          <TabsTrigger value="json" className="flex-1">{t('export.format_project_json')}</TabsTrigger>
        </TabsList>
      </Tabs>

      <p className="text-xs text-muted-foreground">{t(`export.format_${format === 'csv' ? 'csv' : 'project_json'}_hint`)}</p>

      {format === 'csv' && missing.length > 0 && (
        <NoticeBanner
          tone="warning"
          title={t('export.missing_concept_sets', { count: missing.length })}
          description={missing.map((p) => (p.version ? `#${p.id} v${p.version}` : `#${p.id}`)).join(', ')}
        />
      )}

      {content !== null ? (
        <CodePreview text={content.replace(/^\uFEFF/, '')} language={format === 'json' ? 'json' : 'plaintext'} className="min-h-0 flex-1" />
      ) : (
        <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          {t('export.loading_concept_sets')}
        </div>
      )}
    </DialogShell>
  )
}
