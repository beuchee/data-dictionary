import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Checkbox } from '@/components/ui/checkbox'
import { DialogShell } from '@/components/ui/dialog-shell'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ApiError } from '@/lib/api-client'
import {
  createUpload,
  deleteUpload,
  inspectExport,
  startImport,
  uploadFile,
  type ExportSource,
  type ImportJob,
  type InspectedExport,
  type InspectedVocabulary,
} from '@/lib/vocabulary/api-admin'
import { REQUIRED_TABLES, SERVER_ONLY_TABLES, missingTables, pickAthenaFiles } from '@/lib/vocabulary/wasm/athena-files'
import { AthenaFileList } from './athena-file-list'
import { FolderPickerButton } from './folder-picker-button'
import { formatBytes, percent } from './format'

interface ServerImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Server folders an import may read (DD_VOCABULARY_IMPORT_ROOTS); empty = uploads only. */
  importRoots: string[]
  onStarted: (job: ImportJob) => void
}

type Step = 'source' | 'uploading' | 'inspecting' | 'choose' | 'starting'

/** New and changed vocabularies are ticked; one held at this very version is not (Linkr's rule). */
function defaultSelection(vocabularies: readonly InspectedVocabulary[]): Set<string> {
  return new Set(
    vocabularies.filter((v) => !v.inLibrary || v.libraryVersion !== v.vocabularyVersion).map((v) => v.vocabularyId),
  )
}

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    try {
      const detail = (JSON.parse(error.message) as { detail?: unknown }).detail
      if (typeof detail === 'string') return detail
    } catch {
      // not JSON: fall through
    }
  }
  return error instanceof Error ? error.message : String(error)
}

/** Server mode: import an ATHENA export, uploaded from this computer or read from a server folder. */
export function ServerImportDialog({ open, onOpenChange, importRoots, onStarted }: ServerImportDialogProps) {
  const { t, i18n } = useTranslation()
  const [tab, setTab] = useState<'upload' | 'folder'>('upload')
  const [step, setStep] = useState<Step>('source')
  const [folderName, setFolderName] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [serverPath, setServerPath] = useState('')
  const [sent, setSent] = useState(0)
  const [source, setSource] = useState<ExportSource | null>(null)
  const [inspected, setInspected] = useState<InspectedExport | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const numberFormat = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language])

  const athenaFiles = useMemo(() => [...pickAthenaFiles(files, SERVER_ONLY_TABLES).values()], [files])
  const missing = useMemo(() => missingTables(pickAthenaFiles(files, SERVER_ONLY_TABLES)), [files])
  const totalBytes = athenaFiles.reduce((n, f) => n + f.size, 0)
  const working = step === 'uploading' || step === 'inspecting' || step === 'starting'

  const reset = () => {
    setStep('source')
    setFiles([])
    setFolderName('')
    setSent(0)
    setSource(null)
    setInspected(null)
    setChosen(new Set())
    setError(null)
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      // An upload never imported is dropped (the server also prunes it after a day).
      if (source?.uploadId && step !== 'starting') void deleteUpload(source.uploadId).catch(() => undefined)
      reset()
    }
    onOpenChange(next)
  }

  const inspect = async (from: ExportSource) => {
    setStep('inspecting')
    const found = await inspectExport(from)
    setInspected(found)
    setChosen(defaultSelection(found.vocabularies))
    setStep('choose')
  }

  const handleUploadAndInspect = async () => {
    setError(null)
    setStep('uploading')
    setSent(0)
    let uploadId: string | null = null
    try {
      uploadId = await createUpload()
      setSource({ uploadId })
      let done = 0
      for (const file of athenaFiles) {
        await uploadFile(uploadId, file, (bytes) => setSent(done + bytes))
        done += file.size
        setSent(done)
      }
      await inspect({ uploadId })
    } catch (e) {
      setError(errorText(e))
      setStep('source')
      if (uploadId) void deleteUpload(uploadId).catch(() => undefined)
      setSource(null)
    }
  }

  const handleInspectFolder = async () => {
    setError(null)
    const from = { serverPath: serverPath.trim() }
    setSource(from)
    try {
      await inspect(from)
    } catch (e) {
      setError(errorText(e))
      setStep('source')
    }
  }

  const handleImport = async () => {
    if (!source || !chosen.size) return
    setError(null)
    setStep('starting')
    try {
      const job = await startImport(source, [...chosen])
      onStarted(job)
      reset()
      onOpenChange(false)
    } catch (e) {
      setError(errorText(e))
      setStep('choose')
    }
  }

  const toggle = (id: string, on: boolean) =>
    setChosen((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const choosing = step === 'choose' || step === 'starting'
  const canInspect =
    tab === 'upload' ? athenaFiles.length > 0 && missing.length === 0 : serverPath.trim().startsWith('/') || /^[A-Za-z]:\\/.test(serverPath.trim())

  return (
    <DialogShell
      open={open}
      onOpenChange={handleOpenChange}
      kind="settings"
      title={t('vocabulary.import_title')}
      description={t('vocabulary.import_server_description')}
      confirmLabel={choosing ? t('vocabulary.import_n', { count: chosen.size }) : t('vocabulary.next')}
      confirmDisabled={choosing ? chosen.size === 0 : !canInspect}
      busy={working}
      onConfirm={choosing ? handleImport : tab === 'upload' ? handleUploadAndInspect : handleInspectFolder}
    >
      {error && <NoticeBanner tone="danger" title={t('vocabulary.import_error')} description={error} />}

      {!choosing && (
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'upload' | 'folder')}>
          <TabsList className="w-full">
            <TabsTrigger value="upload" className="flex-1" disabled={working}>
              {t('vocabulary.source_upload')}
            </TabsTrigger>
            <TabsTrigger value="folder" className="flex-1" disabled={working || !importRoots.length}>
              {t('vocabulary.source_folder')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="space-y-3 pt-2">
            <p className="text-xs text-muted-foreground">
              {t('vocabulary.upload_hint', { tables: REQUIRED_TABLES.map((x) => x.toUpperCase()).join(', ') })}
            </p>
            <div className="flex items-center gap-3">
              <FolderPickerButton
                disabled={working}
                onPicked={(name, picked) => {
                  setFolderName(name)
                  setFiles(picked)
                  setError(null)
                }}
                onError={(e) => setError(errorText(e))}
              >
                {t('vocabulary.choose_folder')}
              </FolderPickerButton>
              {folderName && <span className="truncate text-xs text-muted-foreground">{folderName}</span>}
            </div>
            {files.length > 0 && (
              <AthenaFileList files={athenaFiles} missing={missing} />
            )}
            {step === 'uploading' && (
              <div className="space-y-1">
                <Progress value={percent(sent, totalBytes)} />
                <p className="text-xs tabular-nums text-muted-foreground">
                  {t('vocabulary.uploading', { sent: formatBytes(sent), total: formatBytes(totalBytes) })}
                </p>
              </div>
            )}
            {step === 'inspecting' && <p className="text-xs text-muted-foreground">{t('vocabulary.inspecting')}</p>}
          </TabsContent>

          <TabsContent value="folder" className="space-y-3 pt-2">
            <FormField label={t('vocabulary.server_path')} hint={t('vocabulary.server_path_hint', { roots: importRoots.join(', ') })}>
              {({ id }) => (
                <Input
                  id={id}
                  value={serverPath}
                  placeholder={importRoots[0] ?? '/srv/athena'}
                  onChange={(e) => setServerPath(e.target.value)}
                  disabled={working}
                />
              )}
            </FormField>
            {step === 'inspecting' && <p className="text-xs text-muted-foreground">{t('vocabulary.inspecting')}</p>}
          </TabsContent>
        </Tabs>
      )}

      {choosing && inspected && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {t('vocabulary.choose_hint', { release: inspected.release ?? t('vocabulary.unknown') })}
          </p>
          <div className="max-h-72 divide-y overflow-auto rounded-md border">
            {inspected.vocabularies.map((v) => (
              <label key={v.vocabularyId} className="flex cursor-pointer items-center gap-3 px-3 py-1.5 hover:bg-accent">
                <Checkbox
                  checked={chosen.has(v.vocabularyId)}
                  onCheckedChange={(on) => toggle(v.vocabularyId, on === true)}
                  disabled={step === 'starting'}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{v.vocabularyId}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {v.vocabularyVersion ?? '—'}
                    {v.inLibrary &&
                      ` · ${
                        v.libraryVersion === v.vocabularyVersion
                          ? t('vocabulary.already_held')
                          : t('vocabulary.replaces', { version: v.libraryVersion ?? '—' })
                      }`}
                  </span>
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {numberFormat.format(v.conceptCount)}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </DialogShell>
  )
}
