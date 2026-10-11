// Adapted from legacy/settings.js (openPicker / searchPicker / confirmPicker): a
// single-select concept search over the loaded vocabulary, so ids and names are
// picked, never typed (issue #6).
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DataTable, type DataTableColumn } from '@/components/ui/data-table'
import { DialogShell } from '@/components/ui/dialog-shell'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { SearchInput } from '@/components/ui/search-input'
import { getVocabularySource, VocabularyUnavailableError, type OmopConcept } from '@/lib/vocabulary'
import { StandardBadge } from '@/features/vocabulary'
import { toConceptRef } from './vocabulary-availability'
import type { ConceptRef } from './unit-rows'

export type PickerKind = 'concept' | 'unit'

const PAGE_LIMIT = 200

interface ConceptPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: PickerKind
  onSelect: (concept: OmopConcept) => void
}

export function ConceptPickerDialog({ open, onOpenChange, kind, onSelect }: ConceptPickerDialogProps) {
  const { t } = useTranslation()
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<OmopConcept[] | null>(null)
  const [total, setTotal] = useState(0)
  const [selected, setSelected] = useState<OmopConcept | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchSeq, setSearchSeq] = useState(0)

  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setTerm('')
      setResults(null)
      setSelected(null)
      setError(null)
    }
  }

  const search = async () => {
    const seq = searchSeq + 1
    setSearchSeq(seq)
    setBusy(true)
    setError(null)
    try {
      const page = await getVocabularySource().searchConcepts({
        term: term.trim() || undefined,
        domainIds: kind === 'unit' ? ['Unit'] : undefined,
        limit: PAGE_LIMIT,
      })
      setResults(page.concepts)
      setTotal(page.total)
      setSelected(null)
    } catch (e) {
      setError(e instanceof VocabularyUnavailableError ? t('units.picker.no_vocabulary') : e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const columns: DataTableColumn<OmopConcept>[] = [
    { id: 'id', header: t('units.col.concept_id'), accessor: (c) => c.conceptId, size: 100, align: 'right' },
    { id: 'name', header: t('units.col.concept_name'), accessor: (c) => c.conceptName, size: 320 },
    { id: 'code', header: t('units.col.code'), accessor: (c) => c.conceptCode, size: 110 },
    { id: 'vocabulary', header: t('units.col.vocabulary'), accessor: (c) => c.vocabularyId, size: 100, filter: 'select' },
    { id: 'domain', header: t('units.col.domain'), accessor: (c) => c.domainId, size: 110, filter: 'select', hidden: kind === 'unit' },
    {
      id: 'standard',
      header: t('units.col.standard'),
      accessor: (c) => c.standardConcept ?? '',
      cell: (c) => <StandardBadge value={c.standardConcept} />,
      size: 110,
    },
  ]

  const confirm = () => {
    if (!selected) return
    onSelect(selected)
    onOpenChange(false)
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      kind="workbench"
      title={t(kind === 'unit' ? 'units.picker.title_unit' : 'units.picker.title_concept')}
      description={t(kind === 'unit' ? 'units.picker.description_unit' : 'units.picker.description_concept')}
      onConfirm={confirm}
      confirmLabel={t('units.picker.select')}
      confirmDisabled={!selected}
      noEnterSubmit
    >
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="flex items-center gap-2">
          <SearchInput
            value={term}
            onChange={setTerm}
            onEnter={() => void search()}
            placeholder={t('units.picker.search_placeholder')}
            className="flex-1"
            autoFocus
          />
          <Button onClick={() => void search()} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            {t('units.picker.search')}
          </Button>
        </div>
        {error && <NoticeBanner tone="danger" title={t('units.picker.error')} description={error} />}
        {results && (
          <p className="text-[10px] text-muted-foreground">
            {t('units.picker.results', { count: results.length, total })}
          </p>
        )}
        <div className="min-h-0 flex-1 overflow-auto">
          {results && (
            <DataTable
              data={results}
              columns={columns}
              rowKey={(c) => c.conceptId}
              onRowClick={setSelected}
              selectedRowKey={selected?.conceptId ?? null}
              emptyMessage={t('units.picker.no_results')}
              pageSize={50}
              cellTooltips="readOnly"
            />
          )}
        </div>
      </div>
    </DialogShell>
  )
}

/** Which extra fields a manual (no vocabulary) entry asks for. */
export type ManualField = 'conceptCode' | 'vocabularyId' | 'domainId'

interface ConceptFieldProps {
  label: string
  value: ConceptRef | null
  onChange: (value: ConceptRef | null) => void
  kind: PickerKind
  vocabulary: 'loading' | 'yes' | 'no'
  manualFields?: ManualField[]
  required?: boolean
}

const MANUAL_LABEL: Record<ManualField, string> = {
  conceptCode: 'units.col.code',
  vocabularyId: 'units.col.vocabulary',
  domainId: 'units.col.domain',
}

/**
 * A concept of a units row. With a vocabulary: the picked concept, read-only
 * (its names come from the vocabulary). Without one: typed id and names.
 */
export function ConceptField({ label, value, onChange, kind, vocabulary, manualFields = [], required }: ConceptFieldProps) {
  const { t } = useTranslation()
  const [pickerOpen, setPickerOpen] = useState(false)

  if (vocabulary !== 'no') {
    return (
      <FormField label={label} required={required}>
        {({ id }) => (
          <div className="flex items-center gap-2">
            <div
              id={id}
              className="flex h-8 min-w-0 flex-1 items-center rounded-md border bg-muted/30 px-2 text-xs"
              title={value ? `${value.conceptId} — ${value.conceptName}` : undefined}
            >
              {value ? (
                <span className="truncate">
                  <span className="font-mono">{value.conceptId}</span> — {value.conceptName}
                  {value.conceptCode ? <span className="text-muted-foreground"> ({value.conceptCode})</span> : null}
                </span>
              ) : (
                <span className="text-muted-foreground">{t(kind === 'unit' ? 'units.picker.no_unit' : 'units.picker.no_concept')}</span>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)} disabled={vocabulary === 'loading'}>
              <Search size={14} />
              {t('units.picker.choose')}
            </Button>
            {value && (
              <Button variant="ghost" size="icon-sm" onClick={() => onChange(null)} aria-label={t('units.picker.clear')}>
                <X size={14} />
              </Button>
            )}
            <ConceptPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} kind={kind} onSelect={(c) => onChange(toConceptRef(c))} />
          </div>
        )}
      </FormField>
    )
  }

  const set = (patch: Partial<ConceptRef>) => {
    const next = { conceptId: value?.conceptId ?? Number.NaN, conceptName: value?.conceptName ?? '', ...value, ...patch }
    onChange(next)
  }
  return (
    <fieldset className="space-y-2 rounded-md border p-3">
      <legend className="px-1 text-xs font-medium">{label}</legend>
      <div className="grid grid-cols-[8rem_1fr] gap-2">
        <FormField label={t('units.col.concept_id')} required={required}>
          {({ id }) => (
            <Input
              id={id}
              inputMode="numeric"
              value={value && Number.isFinite(value.conceptId) ? String(value.conceptId) : ''}
              onChange={(e) => set({ conceptId: /^\d+$/.test(e.target.value.trim()) ? Number(e.target.value.trim()) : Number.NaN })}
            />
          )}
        </FormField>
        <FormField label={t('units.col.name')}>
          {({ id }) => <Input id={id} value={value?.conceptName ?? ''} onChange={(e) => set({ conceptName: e.target.value })} />}
        </FormField>
      </div>
      {manualFields.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {manualFields.map((f) => (
            <FormField key={f} label={t(MANUAL_LABEL[f])}>
              {({ id }) => <Input id={id} value={value?.[f] ?? ''} onChange={(e) => set({ [f]: e.target.value })} />}
            </FormField>
          ))}
        </div>
      )}
    </fieldset>
  )
}
