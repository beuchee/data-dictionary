// Ported from legacy/concept-sets.js (the Custom Concept tab of the Add Concepts
// modal and the edit-custom-concept modal).
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useDomainAndClassOptions } from './use-custom-concepts'
import type { CustomConceptFields, CustomVocabulary } from '../lib/expression'

interface CustomConceptFormProps {
  /** The id it has or will get (shown, not editable). */
  conceptId: number | null
  value: CustomConceptFields
  onChange: (value: CustomConceptFields) => void
  vocabulary: CustomVocabulary
  /** Fields left empty that must not be. */
  missing: readonly string[]
}

/** Name, domain, class, code and vocabulary of a custom concept (not in the OHDSI vocabularies). */
export function CustomConceptForm({ conceptId, value, onChange, vocabulary, missing }: CustomConceptFormProps) {
  const { t } = useTranslation()
  const { domains, classes } = useDomainAndClassOptions()
  const classListId = useId()
  const set = (patch: Partial<CustomConceptFields>) => onChange({ ...value, ...patch })
  const domainOptions = value.domainId && !domains.includes(value.domainId) ? [value.domainId, ...domains] : domains

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <FormField label={t('expression.custom.id')} hint={t('expression.custom.id_hint')}>
        {({ id }) => <Input id={id} value={conceptId ?? '…'} readOnly className="font-mono" />}
      </FormField>
      <FormField label={t('expression.custom.vocabulary')} hint={t('expression.custom.vocabulary_hint', { id: vocabulary.id })}>
        {({ id }) => <Input id={id} value={value.vocabularyId} placeholder={vocabulary.id} onChange={(e) => set({ vocabularyId: e.target.value })} />}
      </FormField>
      <div className="sm:col-span-2">
        <FormField label={t('expression.custom.name')} required>
          {({ id }) => (
            <Input id={id} value={value.name} onChange={(e) => set({ name: e.target.value })} aria-invalid={missing.includes('name') || undefined} autoFocus />
          )}
        </FormField>
      </div>
      <FormField label={t('expression.custom.domain')} required>
        {({ id }) => (
          <Select value={value.domainId} onValueChange={(v) => set({ domainId: v })}>
            <SelectTrigger id={id} size="sm" className="w-full" aria-invalid={missing.includes('domain') || undefined}>
              <SelectValue placeholder={t('expression.custom.pick')} />
            </SelectTrigger>
            <SelectContent>
              {domainOptions.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </FormField>
      <FormField label={t('expression.custom.class')} required>
        {({ id }) => (
          <>
            <Input
              id={id}
              list={classListId}
              value={value.conceptClassId}
              onChange={(e) => set({ conceptClassId: e.target.value })}
              aria-invalid={missing.includes('class') || undefined}
            />
            <datalist id={classListId}>
              {classes.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </>
        )}
      </FormField>
      <div className="sm:col-span-2">
        <FormField label={t('expression.custom.code')} hint={t('expression.custom.code_hint', { prefix: vocabulary.codePrefix })}>
          {({ id }) => (
            <Input id={id} value={value.code} placeholder={conceptId ? `${vocabulary.codePrefix}${conceptId}` : ''} onChange={(e) => set({ code: e.target.value })} />
          )}
        </FormField>
      </div>
    </div>
  )
}
