import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DialogShell } from '@/components/ui/dialog-shell'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { Progress } from '@/components/ui/progress'
import { REQUIRED_TABLES, missingTables, pickAthenaFiles } from '@/lib/vocabulary/wasm/athena-files'
import type { WasmImportProgress } from '@/lib/vocabulary/wasm/library'
import { AthenaFileList } from './athena-file-list'
import { FolderPickerButton } from './folder-picker-button'
import { percent } from './format'

interface BrowserImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => void
}

/** Static mode: load an ATHENA folder into this browser's DuckDB-WASM. */
export function BrowserImportDialog({ open, onOpenChange, onDone }: BrowserImportDialogProps) {
  const { t } = useTranslation()
  const [folderName, setFolderName] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [progress, setProgress] = useState<WasmImportProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notPersisted, setNotPersisted] = useState(false)

  const picked = useMemo(() => pickAthenaFiles(files), [files])
  const missing = useMemo(() => missingTables(picked), [picked])
  const running = progress !== null && progress.step !== 'done'

  const reset = () => {
    setFolderName('')
    setFiles([])
    setProgress(null)
    setError(null)
    setNotPersisted(false)
  }

  const handleOpenChange = (next: boolean) => {
    // An import cannot be cancelled half-way: the database would be half-built.
    if (!next && running) return
    if (!next) reset()
    onOpenChange(next)
  }

  const handleImport = async () => {
    setError(null)
    setProgress({ step: 'filter_ids', done: 0, total: 1 })
    try {
      const { importAthenaFiles } = await import('@/lib/vocabulary/wasm/library')
      const result = await importAthenaFiles([...picked.values()], folderName, setProgress)
      onDone()
      if (!result.persisted) {
        setNotPersisted(true)
        return
      }
      reset()
      onOpenChange(false)
    } catch (e) {
      console.error('Browser vocabulary import failed:', e)
      setProgress(null)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const stepLabel = (p: WasmImportProgress) =>
    p.step === 'table' && p.table ? t('vocabulary.step_table', { table: p.table }) : t(`vocabulary.step_${p.step}`)

  return (
    <DialogShell
      open={open}
      onOpenChange={handleOpenChange}
      kind="settings"
      title={t('vocabulary.import_title')}
      description={t('vocabulary.import_browser_description')}
      confirmLabel={notPersisted ? t('common.close') : t('vocabulary.import')}
      confirmDisabled={!notPersisted && (picked.size === 0 || missing.length > 0)}
      busy={running}
      hideCancel={notPersisted}
      onConfirm={notPersisted ? () => handleOpenChange(false) : handleImport}
    >
      {error && <NoticeBanner tone="danger" title={t('vocabulary.import_error')} description={error} />}
      {notPersisted && (
        <NoticeBanner tone="warning" title={t('vocabulary.not_persisted')} description={t('vocabulary.not_persisted_hint')} />
      )}

      {!notPersisted && (
        <>
          <p className="text-xs text-muted-foreground">
            {t('vocabulary.browser_hint', { tables: REQUIRED_TABLES.map((x) => x.toUpperCase()).join(', ') })}
          </p>
          <div className="flex items-center gap-3">
            <FolderPickerButton
              disabled={running}
              onPicked={(name, list) => {
                setFolderName(name)
                setFiles(list)
                setError(null)
              }}
              onError={(e) => setError(e instanceof Error ? e.message : String(e))}
            >
              {t('vocabulary.choose_folder')}
            </FolderPickerButton>
            {folderName && <span className="truncate text-xs text-muted-foreground">{folderName}</span>}
          </div>
          {files.length > 0 && <AthenaFileList files={[...picked.values()]} missing={missing} />}
          {progress && (
            <div className="space-y-1">
              <Progress value={percent(progress.done, progress.total)} />
              <p className="text-xs text-muted-foreground">{stepLabel(progress)}</p>
            </div>
          )}
        </>
      )}
    </DialogShell>
  )
}
