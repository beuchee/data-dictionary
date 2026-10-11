import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DialogShell } from '@/components/ui/dialog-shell'
import { FieldError } from '@/components/ui/field-error'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LocalProfileFields } from '@/features/drafts/local-profile-fields'
import { useInstanceConfig } from '@/stores/config-store'
import { EMPTY_METADATA, categoryOptions, counterpart, metadataFields, type MetadataFields } from '../lib/editing'
import type { ConceptSet } from '@data-dictionary/format'
import type { ConceptSetSummary } from '@/lib/data'

interface MetadataDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null: create a concept set. */
  conceptSet: ConceptSet | null
  /** Every set of the catalog, for the category suggestions. */
  summaries: readonly ConceptSetSummary[]
  onSubmit: (values: Record<string, MetadataFields>) => void | Promise<void>
  busy?: boolean
}

/**
 * Name, category, subcategory and one-line description, in each language of
 * the instance. Categories are suggested from the existing sets, cascading to
 * their subcategories, and picking one fills the other languages' empty
 * fields with the translation existing sets pair it with.
 */
export function MetadataDialog({ open, onOpenChange, conceptSet, summaries, onSubmit, busy }: MetadataDialogProps) {
  const { t, i18n } = useTranslation()
  const config = useInstanceConfig()
  const languages = config.languages
  const required = languages.includes(i18n.language) ? i18n.language : config.defaultLanguage
  const [tab, setTab] = useState(required)
  const [values, setValues] = useState<Record<string, MetadataFields>>({})
  const [submitted, setSubmitted] = useState(false)
  const listId = useId()

  // Reset when the dialog opens (state adjusted during render, not in an effect).
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setValues(Object.fromEntries(languages.map((l) => [l, conceptSet ? metadataFields(conceptSet, l) : { ...EMPTY_METADATA }])))
      setTab(required)
      setSubmitted(false)
    }
  }

  const options = useMemo(() => Object.fromEntries(languages.map((l) => [l, categoryOptions(summaries, l)])), [languages, summaries])
  const nameMissing = !values[required]?.name.trim()
  const categoryMissing = !values[required]?.category.trim()

  const setField = (lang: string, field: keyof MetadataFields, value: string) => {
    setValues((prev) => ({ ...prev, [lang]: { ...prev[lang], [field]: value } }))
  }

  // Fill the other languages' empty category / subcategory from what existing sets pair it with.
  const pairAcross = (lang: string, field: 'category' | 'subcategory') => {
    const value = values[lang]?.[field] ?? ''
    setValues((prev) => {
      const next = { ...prev }
      for (const other of languages) {
        if (other === lang || next[other]?.[field].trim()) continue
        const match = counterpart(summaries, field, lang, other, value)
        if (match) next[other] = { ...next[other], [field]: match }
      }
      return next
    })
  }

  const confirm = () => {
    setSubmitted(true)
    if (nameMissing || categoryMissing) {
      setTab(required)
      return
    }
    void onSubmit(values)
  }

  const fields = (lang: string) => {
    const v = values[lang] ?? EMPTY_METADATA
    const opts = options[lang]
    const subs = opts?.subcategories.get(v.category.trim()) ?? []
    const isRequired = lang === required
    return (
      <div className="space-y-3">
        <FormField label={t('concept_sets.edit.name')} required={isRequired}>
          {({ id }) => (
            <>
              <Input id={id} value={v.name} onChange={(e) => setField(lang, 'name', e.target.value)} autoFocus={isRequired} />
              <FieldError message={submitted && isRequired && nameMissing ? t('concept_sets.edit.name_required') : null} />
            </>
          )}
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label={t('concept_sets.columns.category')} required={isRequired}>
            {({ id }) => (
              <>
                <Input
                  id={id}
                  list={`${listId}-cat-${lang}`}
                  value={v.category}
                  onChange={(e) => setField(lang, 'category', e.target.value)}
                  onBlur={() => pairAcross(lang, 'category')}
                  autoComplete="off"
                />
                <datalist id={`${listId}-cat-${lang}`}>
                  {opts?.categories.map((c) => <option key={c} value={c} />)}
                </datalist>
                <FieldError message={submitted && isRequired && categoryMissing ? t('concept_sets.edit.category_required') : null} />
              </>
            )}
          </FormField>
          <FormField label={t('concept_sets.columns.subcategory')}>
            {({ id }) => (
              <>
                <Input
                  id={id}
                  list={`${listId}-sub-${lang}`}
                  value={v.subcategory}
                  onChange={(e) => setField(lang, 'subcategory', e.target.value)}
                  onBlur={() => pairAcross(lang, 'subcategory')}
                  autoComplete="off"
                />
                <datalist id={`${listId}-sub-${lang}`}>
                  {subs.map((s) => <option key={s} value={s} />)}
                </datalist>
              </>
            )}
          </FormField>
        </div>
        <FormField label={t('concept_sets.edit.short_description')} hint={t('concept_sets.edit.short_description_hint')}>
          {({ id }) => <Input id={id} value={v.shortDescription} onChange={(e) => setField(lang, 'shortDescription', e.target.value)} />}
        </FormField>
      </div>
    )
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      kind="settings"
      title={conceptSet ? t('concept_sets.edit.metadata_title') : t('concept_sets.edit.create_title')}
      description={t('concept_sets.edit.metadata_description')}
      onConfirm={confirm}
      confirmLabel={conceptSet ? t('concept_sets.edit.apply') : t('concept_sets.edit.create')}
      busy={busy}
    >
      {languages.length > 1 ? (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full">
            {languages.map((l) => (
              <TabsTrigger key={l} value={l} className="flex-1">
                {l.toUpperCase()}
              </TabsTrigger>
            ))}
          </TabsList>
          {languages.map((l) => (
            <TabsContent key={l} value={l} className="mt-3">
              {fields(l)}
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        fields(languages[0])
      )}
      {!conceptSet && <LocalProfileFields fields={['firstName', 'lastName', 'affiliation', 'orcid']} />}
    </DialogShell>
  )
}
