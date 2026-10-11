import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, ImageUp, TriangleAlert, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { COLOR_PALETTE, ColorPickerPopover } from '@/components/ui/color-picker-popover'
import { FileDropZone } from '@/components/ui/file-drop-zone'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { MIN_CONTRAST } from '@/lib/theme'
import { cn } from '@/lib/utils'
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_ASSET_BYTES,
  checkAssetFile,
  contrastCheck,
  previewVariables,
  type AssetKind,
  type AssetUpload,
} from './branding-form'

// --- Colors ---------------------------------------------------------------------

interface ColorFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
}

/** A brand color: palette / picker, or a typed hex; with its WCAG check. */
export function ColorField({ label, value, onChange }: ColorFieldProps) {
  const { t } = useTranslation()
  const check = value.trim() ? contrastCheck(value.trim()) : null
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <ColorPickerPopover
          value={value || 'none'}
          onChange={(v) => {
            if (v === 'none') onChange('')
            else if (v.startsWith('#')) onChange(v)
            else onChange(COLOR_PALETTE.find((c) => c.name === v)?.hex ?? '')
          }}
        />
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={t('branding.colors.default')} className="w-28 font-mono" aria-label={label} />
        {value.trim() && !check && <span className="text-xs text-destructive">{t('branding.colors.invalid')}</span>}
        {check && (
          <Badge variant="outline" className={cn(!check.passes && 'border-destructive text-destructive')}>
            {check.passes ? <CheckCircle2 size={12} /> : <TriangleAlert size={12} />}
            {t('branding.colors.contrast', { light: check.onColor.toFixed(1), dark: check.darkOnBackground.toFixed(1), min: MIN_CONTRAST })}
          </Badge>
        )}
      </div>
    </div>
  )
}

interface ThemePreviewProps {
  primary: string
  secondary: string
}

/** The derived tokens on a sample of controls, in light and dark mode, scoped to this box. */
export function ThemePreview({ primary, secondary }: ThemePreviewProps) {
  const { t } = useTranslation()
  const vars = previewVariables(primary, secondary)
  const sample = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">{t('branding.colors.sample_primary')}</span>
      <span className="rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground">{t('branding.colors.sample_secondary')}</span>
      <span className="text-xs font-medium text-primary underline">{t('branding.colors.sample_link')}</span>
      <span className="rounded-md border px-2 py-1 text-xs ring-2 ring-ring">{t('branding.colors.sample_focus')}</span>
    </div>
  )
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="space-y-1.5 rounded-md border bg-background p-3 text-foreground" style={vars.light as React.CSSProperties}>
        <span className="text-[10px] text-muted-foreground uppercase">{t('branding.colors.light')}</span>
        {sample}
      </div>
      <div className="dark space-y-1.5 rounded-md border bg-background p-3 text-foreground" style={vars.dark as React.CSSProperties}>
        <span className="text-[10px] text-muted-foreground uppercase">{t('branding.colors.dark')}</span>
        {sample}
      </div>
    </div>
  )
}

// --- Images -----------------------------------------------------------------------

interface ImageFieldProps {
  kind: AssetKind
  label: string
  /** What is shown now: the pending upload, else the configured image. */
  currentUrl: string | null
  upload: AssetUpload | undefined
  onUpload: (upload: AssetUpload | undefined) => void
  /** Static mode: images cannot be proposed through the forge's edit page. */
  disabledReason?: string
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'))
    reader.readAsDataURL(file)
  })
}

export function ImageField({ kind, label, currentUrl, upload, onUpload, disabledReason }: ImageFieldProps) {
  const { t } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const preview = upload?.base64 ?? currentUrl

  const take = async (file: File | undefined) => {
    if (!file) return
    const problem = checkAssetFile(kind, file)
    if (problem) {
      setError(t(`branding.images.error.${problem}`, { max: Math.round(MAX_ASSET_BYTES[kind] / 1024) }))
      return
    }
    setError(null)
    try {
      onUpload({ filename: file.name, base64: await readAsDataUrl(file) })
    } catch (e) {
      console.error('Could not read the image', e)
      setError(t('branding.images.error.read'))
    }
  }

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex items-start gap-3">
        <div className="flex size-28 shrink-0 items-center justify-center rounded-lg border bg-muted/30 p-2">
          {preview ? <img src={preview} alt={label} className="max-h-full max-w-full object-contain" /> : <span className="text-[10px] text-muted-foreground">{t('branding.images.none')}</span>}
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <FileDropZone
            icon={<ImageUp size={18} className="text-muted-foreground" />}
            label={disabledReason ?? t('branding.images.drop')}
            hint={t('branding.images.hint', { max: Math.round(MAX_ASSET_BYTES[kind] / 1024) })}
            onClick={() => input.current?.click()}
            onDropFiles={(files) => void take(files[0])}
            disabled={!!disabledReason}
          />
          <input
            ref={input}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES.join(',')}
            className="hidden"
            onChange={(e) => {
              void take(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          {upload && (
            <Button variant="ghost" size="xs" onClick={() => onUpload(undefined)}>
              <X size={12} />
              {t('branding.images.remove_upload', { name: upload.filename })}
            </Button>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </div>
    </div>
  )
}

// --- Switch row ----------------------------------------------------------------

interface SwitchRowProps {
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
}

export function SwitchRow({ label, hint, checked, onChange }: SwitchRowProps) {
  return (
    <label className="flex items-start justify-between gap-4">
      <span className="space-y-0.5">
        <span className="block text-sm">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  )
}
