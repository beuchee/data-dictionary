// Adapted from linkr@1310cf4a4 apps/web/src/features/warehouse/concept-mapping/CreateMappingProjectDialog.tsx
// (file drop, parse options, column roles, preview); formats, detection and
// parsing are this app's (@/lib/mapping-import).
import { useMemo, useRef, useState, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { FileSpreadsheet, Upload, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { Textarea } from '@/components/ui/textarea'
import { MAPPING_FORMATS, type InputFile, type MappingFormat, type ParseOptions } from '@/lib/mapping-import'
import { cn } from '@/lib/utils'
import { useMappingsStore } from '@/stores/mappings-store'
import { buildModel, inspectFiles, optionsFor } from './import-model'
import { ImportOptions } from './import-options'
import { ImportPreview } from './import-preview'
import { importErrorMessage } from './labels'

interface ImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (id: string) => void
}

const ACCEPT = '.csv,.tsv,.txt,.tab,.xlsx,.zip,.json'

async function readFiles(list: FileList | File[]): Promise<InputFile[]> {
  return Promise.all([...list].map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })))
}

/** "New import": files → detected format (editable) → options and column roles → preview → save. */
export function ImportDialog({ open, onOpenChange, onCreated }: ImportDialogProps) {
  const { t } = useTranslation()
  const createImport = useMappingsStore((s) => s.createImport)
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<InputFile[]>([])
  const [options, setOptions] = useState<ParseOptions | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const inspected = useMemo(() => inspectFiles(files), [files])
  const model = useMemo(
    () => (options && files.length ? buildModel(files, inspected.expanded, inspected.detection, options) : null),
    [files, inspected, options],
  )
  const error = inspected.error ?? model?.error ?? null

  const reset = () => {
    setFiles([])
    setOptions(null)
    setName('')
    setDescription('')
    setSaveError(null)
    setSaving(false)
  }

  const addFiles = async (list: FileList | File[]) => {
    const next = [...files, ...(await readFiles(list))]
    const info = inspectFiles(next)
    setFiles(next)
    setSaveError(null)
    setOptions(info.detection ? { ...info.detection.options, format: info.detection.format } : { format: 'generic' })
  }

  const removeFile = (index: number) => {
    const next = files.filter((_, i) => i !== index)
    const info = inspectFiles(next)
    setFiles(next)
    setOptions(next.length && info.detection ? { ...info.detection.options, format: info.detection.format } : null)
  }

  const setFormat = (format: MappingFormat) => {
    if (!options) return
    setOptions(optionsFor(format, inspected.detection, inspected.expanded, options))
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files)
  }

  const handleSave = async () => {
    if (!model?.result || !options) return
    setSaving(true)
    setSaveError(null)
    try {
      const created = await createImport({ name, description, files, options, parsed: model.result })
      reset()
      onOpenChange(false)
      onCreated(created.id)
    } catch (e) {
      setSaving(false)
      setSaveError(importErrorMessage(t, e))
    }
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={(next) => {
        if (saving) return
        if (!next) reset()
        onOpenChange(next)
      }}
      kind="workbench"
      title={t('coverage.import_title')}
      description={t('coverage.import_description')}
      confirmLabel={t('coverage.import_confirm')}
      confirmDisabled={!model?.result || !!error}
      busy={saving}
      onConfirm={handleSave}
    >
      <div className="flex flex-col gap-4 pr-1">
        {/* Files */}
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={cn(
            'flex flex-col gap-2 rounded-md border border-dashed p-3',
            dragging ? 'border-primary bg-primary/5' : 'border-border',
          )}
        >
          {files.length === 0 ? (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex flex-col items-center gap-1 py-6 text-xs text-muted-foreground hover:text-foreground"
            >
              <Upload size={20} />
              <span>{t('coverage.drop_hint')}</span>
              <span className="text-[10px]">{t('coverage.drop_formats')}</span>
            </button>
          ) : (
            <>
              {files.map((f, i) => (
                <div key={`${f.name}-${i}`} className="flex items-center gap-2 text-sm">
                  <FileSpreadsheet size={14} className="shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <span className="text-[10px] text-muted-foreground">{(f.data.byteLength / 1024).toFixed(0)} KB</span>
                  <Button variant="ghost" size="icon-xs" aria-label={t('coverage.remove_file')} onClick={() => removeFile(i)}>
                    <X size={12} />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="xs" className="self-start" onClick={() => inputRef.current?.click()}>
                <Upload size={12} />
                {t('coverage.add_file')}
              </Button>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) void addFiles(e.target.files)
              e.target.value = ''
            }}
          />
        </div>

        {options && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">{t('coverage.format')}</span>
              {MAPPING_FORMATS.map((f) => (
                <Button
                  key={f}
                  size="xs"
                  variant={options.format === f ? 'default' : 'outline'}
                  onClick={() => setFormat(f)}
                >
                  {t(`coverage.formats.${f}`)}
                </Button>
              ))}
              {inspected.detection && (
                <Badge variant="secondary">{t('coverage.detected', { format: t(`coverage.formats.${inspected.detection.format}`) })}</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t(`coverage.format_hints.${options.format}`)}</p>

            {model && <ImportOptions options={options} model={model} onChange={setOptions} />}

            {error && <NoticeBanner tone="danger" title={importErrorMessage(t, error)} />}
            {saveError && <NoticeBanner tone="danger" title={saveError} />}

            {model && <ImportPreview model={model} format={options.format} />}

            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label={t('coverage.name')}>
                {({ id }) => (
                  <Input
                    id={id}
                    value={name}
                    placeholder={model?.result?.suggestedName ?? files[0]?.name ?? ''}
                    maxLength={255}
                    onChange={(e) => setName(e.target.value)}
                  />
                )}
              </FormField>
              <FormField label={t('coverage.description_label')}>
                {({ id }) => (
                  <Textarea id={id} rows={1} value={description} maxLength={5000} onChange={(e) => setDescription(e.target.value)} />
                )}
              </FormField>
            </div>
          </>
        )}
      </div>
    </DialogShell>
  )
}
