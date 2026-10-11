import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight } from 'lucide-react'
import { DialogShell } from '@/components/ui/dialog-shell'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { ConceptField } from './concept-picker'
import { useVocabularyAvailable } from './vocabulary-availability'
import {
  buildConversionRow,
  buildRecommendedRow,
  conversionForm,
  convertValue,
  formatConverted,
  formulaLabel,
  parseNumberInput,
  recommendedForm,
  validateConversion,
  validateRecommended,
  type ConversionForm,
  type RecommendedForm,
} from './unit-rows'
import type { JsonNumber, RecommendedUnit, UnitConversion } from '@data-dictionary/format'

// --- Test a conversion --------------------------------------------------------

interface TestConversionDialogProps {
  row: UnitConversion | null
  onOpenChange: (open: boolean) => void
}

/** v1's "Test" modal: type a value in the source unit, read it in the target unit. */
export function TestConversionDialog({ row, onOpenChange }: TestConversionDialogProps) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [lastRow, setLastRow] = useState<UnitConversion | null>(null)
  if (row !== lastRow) {
    setLastRow(row)
    setValue('')
  }
  if (!row) return null
  const source = row.sourceUnitCode || row.sourceUnitName || `${row.sourceUnitConceptId}`
  const target = row.targetUnitCode || row.targetUnitName || `${row.targetUnitConceptId}`
  const parsed = parseNumberInput(value)
  const result = parsed === null ? null : convertValue(Number(parsed), row)

  return (
    <DialogShell
      open
      onOpenChange={onOpenChange}
      title={t('units.test.title')}
      description={row.conceptName || `${row.conceptId}`}
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        {source} <ArrowRight size={14} className="text-primary" /> {target}
        <span className="ml-auto font-mono text-xs text-muted-foreground">{formulaLabel(row)}</span>
      </div>
      <FormField label={t('units.test.value', { unit: source })}>
        {({ id }) => <Input id={id} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />}
      </FormField>
      <div className="rounded-md border bg-muted/30 p-3 text-sm" aria-live="polite">
        <span className="text-xs text-muted-foreground">{t('units.test.result')}</span>
        <div className="font-mono text-base">{result === null ? '—' : `${formatConverted(result)} ${target}`}</div>
      </div>
    </DialogShell>
  )
}

// --- Add / edit a conversion --------------------------------------------------

interface ConversionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  rows: readonly UnitConversion[]
  /** The row edited; null to add one. */
  editIndex: number | null
  onSubmit: (row: UnitConversion, editIndex: number | null) => void
}

export function ConversionDialog({ open, onOpenChange, rows, editIndex, onSubmit }: ConversionDialogProps) {
  const { t } = useTranslation()
  const vocabulary = useVocabularyAvailable()
  const existing = editIndex === null ? undefined : rows[editIndex]
  const [form, setForm] = useState<ConversionForm>(() => conversionForm(existing))
  const [tried, setTried] = useState(false)
  const [openedFor, setOpenedFor] = useState<number | null | undefined>(undefined)
  const key = open ? editIndex : undefined
  if (key !== openedFor) {
    setOpenedFor(key)
    if (open) {
      setForm(conversionForm(existing))
      setTried(false)
    }
  }
  const error = validateConversion(form, rows, editIndex)
  const set = (patch: Partial<ConversionForm>) => setForm((f) => ({ ...f, ...patch }))

  const confirm = () => {
    setTried(true)
    if (error) return
    onSubmit(buildConversionRow(form, existing), editIndex)
    onOpenChange(false)
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      kind="settings"
      title={t(existing ? 'units.conversions.edit_title' : 'units.conversions.add_title')}
      onConfirm={confirm}
      confirmLabel={t(existing ? 'common.save' : 'units.add')}
      confirmDisabled={tried && !!error}
    >
      {vocabulary === 'no' && <NoticeBanner tone="warning" title={t('units.picker.manual_entry')} />}
      <ConceptField label={t('units.col.concept')} kind="concept" vocabulary={vocabulary} value={form.concept} onChange={(concept) => set({ concept })} required />
      <ConceptField
        label={t('units.col.source_unit')}
        kind="unit"
        vocabulary={vocabulary}
        manualFields={['conceptCode']}
        value={form.source}
        onChange={(source) => set({ source })}
        required
      />
      <ConceptField
        label={t('units.col.target_unit')}
        kind="unit"
        vocabulary={vocabulary}
        manualFields={['conceptCode']}
        value={form.target}
        onChange={(target) => set({ target })}
        required
      />
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t('units.col.factor')} required hint={t('units.conversions.factor_hint')} hintInTooltip>
          {({ id }) => <Input id={id} inputMode="decimal" value={form.factor} onChange={(e) => set({ factor: e.target.value })} />}
        </FormField>
        <FormField label={t('units.col.offset')} hint={t('units.conversions.offset_hint')} hintInTooltip>
          {({ id }) => <Input id={id} inputMode="decimal" value={form.offset} onChange={(e) => set({ offset: e.target.value })} placeholder="0" />}
        </FormField>
      </div>
      {tried && error && <NoticeBanner tone="danger" title={t(`units.conversions.error.${error}`)} />}
    </DialogShell>
  )
}

// --- Add / edit a recommended unit --------------------------------------------

interface RecommendedUnitDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  rows: readonly RecommendedUnit[]
  editIndex: number | null
  onSubmit: (row: RecommendedUnit, editIndex: number | null) => void
}

export function RecommendedUnitDialog({ open, onOpenChange, rows, editIndex, onSubmit }: RecommendedUnitDialogProps) {
  const { t } = useTranslation()
  const vocabulary = useVocabularyAvailable()
  const existing = editIndex === null ? undefined : rows[editIndex]
  const [form, setForm] = useState<RecommendedForm>(() => recommendedForm(existing))
  const [tried, setTried] = useState(false)
  const [openedFor, setOpenedFor] = useState<number | null | undefined>(undefined)
  const key = open ? editIndex : undefined
  if (key !== openedFor) {
    setOpenedFor(key)
    if (open) {
      setForm(recommendedForm(existing))
      setTried(false)
    }
  }
  const error = validateRecommended(form, rows, editIndex)

  const confirm = () => {
    setTried(true)
    if (error) return
    onSubmit(buildRecommendedRow(form, existing), editIndex)
    onOpenChange(false)
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      kind="settings"
      title={t(existing ? 'units.recommended.edit_title' : 'units.recommended.add_title')}
      onConfirm={confirm}
      confirmLabel={t(existing ? 'common.save' : 'units.add')}
      confirmDisabled={tried && !!error}
    >
      {vocabulary === 'no' && <NoticeBanner tone="warning" title={t('units.picker.manual_entry')} />}
      <ConceptField
        label={t('units.col.concept')}
        kind="concept"
        vocabulary={vocabulary}
        manualFields={['conceptCode', 'vocabularyId', 'domainId']}
        value={form.concept}
        onChange={(concept) => setForm((f) => ({ ...f, concept }))}
        required
      />
      <ConceptField
        label={t('units.col.recommended_unit')}
        kind="unit"
        vocabulary={vocabulary}
        manualFields={['conceptCode', 'vocabularyId']}
        value={form.unit}
        onChange={(unit) => setForm((f) => ({ ...f, unit }))}
        required
      />
      <p className="text-xs text-muted-foreground">{t('units.recommended.methodology')}</p>
      {tried && error && <NoticeBanner tone="danger" title={t(`units.recommended.error.${error}`)} />}
    </DialogShell>
  )
}

// --- Inline number cell -------------------------------------------------------

interface InlineNumberCellProps {
  value: JsonNumber
  display: React.ReactNode
  /** Returns false when the text is refused (the input stays open, marked invalid). */
  onCommit: (text: string) => boolean
  label: string
}

/** v1's inline factor edit: click, type, Enter or blur saves, Escape cancels. */
export function InlineNumberCell({ value, display, onCommit, label }: InlineNumberCellProps) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [invalid, setInvalid] = useState(false)
  // The blur that fires as the input goes away must not save again (v1's `done`).
  const done = useRef(false)

  if (!editing) {
    return (
      <button
        type="button"
        className="w-full cursor-text rounded px-1 text-right hover:bg-accent"
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation()
          setText(String(value))
          setInvalid(false)
          done.current = false
          setEditing(true)
        }}
      >
        {display}
      </button>
    )
  }
  const finish = (save: boolean) => {
    if (done.current) return
    if (save && !onCommit(text)) {
      setInvalid(true)
      return
    }
    done.current = true
    setEditing(false)
  }
  return (
    <Input
      autoFocus
      inputMode="decimal"
      aria-label={label}
      aria-invalid={invalid || undefined}
      className="h-6 px-1 text-right text-xs"
      value={text}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        setText(e.target.value)
        setInvalid(false)
      }}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finish(!invalid)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(true)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          finish(false)
        }
      }}
    />
  )
}
