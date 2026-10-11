import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DialogShell } from '@/components/ui/dialog-shell'
import { Label } from '@/components/ui/label'
import { useInstanceConfig } from '@/stores/config-store'
import { todayIso } from '@/features/drafts/identity'
import {
  customConceptErrors,
  customConceptFields,
  customConceptItem,
  customVocabulary,
  updateCustomConcept,
  type CustomConceptFields,
} from '../lib/expression'
import { CustomConceptForm } from './custom-concept-form'
import { useNextCustomId } from './use-custom-concepts'
import type { ExpressionItem } from '@data-dictionary/format'

const EMPTY: CustomConceptFields = { name: '', domainId: '', conceptClassId: '', code: '', vocabularyId: '' }

interface CustomConceptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: ExpressionItem[]
  /** The custom concept of `items` to edit. */
  index: number
  onChange: (items: ExpressionItem[]) => void
}

/** Renames / reclassifies a custom concept of the expression (v1's edit-custom-concept modal). */
export function CustomConceptDialog({ open, onOpenChange, items, index, onChange }: CustomConceptDialogProps) {
  const { t } = useTranslation()
  const vocabulary = customVocabulary(useInstanceConfig())
  const concept = items[index].concept
  const [value, setValue] = useState(() => customConceptFields(concept))
  const [tried, setTried] = useState(false)
  const missing = tried ? customConceptErrors(value) : []

  const save = () => {
    setTried(true)
    if (customConceptErrors(value).length) return
    onChange(updateCustomConcept(items, index, value, vocabulary))
  }

  return (
    <DialogShell open={open} onOpenChange={onOpenChange} kind="settings" title={t('expression.custom.edit_title')} onConfirm={save} confirmLabel={t('common.save')}>
      <CustomConceptForm conceptId={concept.conceptId} value={value} onChange={setValue} vocabulary={vocabulary} missing={missing} />
    </DialogShell>
  )
}

interface CustomConceptPanelProps {
  items: ExpressionItem[]
  onChange: (items: ExpressionItem[]) => void
}

/** The Add dialog's "Custom concept" tab: creates one, keeps the form open for the next (v1). */
export function CustomConceptPanel({ items, onChange }: CustomConceptPanelProps) {
  const { t } = useTranslation()
  const vocabulary = customVocabulary(useInstanceConfig())
  const nextId = useNextCustomId(items)
  const [value, setValue] = useState<CustomConceptFields>(EMPTY)
  const [excluded, setExcluded] = useState(false)
  const [tried, setTried] = useState(false)
  const [added, setAdded] = useState<string | null>(null)
  const missing = tried ? customConceptErrors(value) : []

  const add = () => {
    setTried(true)
    if (nextId === null || customConceptErrors(value).length) return
    onChange([...items, customConceptItem(nextId, value, vocabulary, todayIso(), excluded)])
    setAdded(value.name.trim())
    setValue({ ...EMPTY, domainId: value.domainId, conceptClassId: value.conceptClassId, vocabularyId: value.vocabularyId })
    setTried(false)
  }

  return (
    <div className="space-y-4 p-1">
      <p className="text-xs text-muted-foreground">{t('expression.custom.intro', { vocabulary: vocabulary.id })}</p>
      <CustomConceptForm conceptId={nextId} value={value} onChange={setValue} vocabulary={vocabulary} missing={missing} />
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Checkbox id="custom-concept-exclude" checked={excluded} onCheckedChange={(v) => setExcluded(v === true)} />
          <Label htmlFor="custom-concept-exclude">{t('concept_sets.concepts.exclude')}</Label>
        </div>
        <Button className="ml-auto" onClick={add} disabled={nextId === null}>
          <Plus size={14} />
          {t('expression.custom.add')}
        </Button>
      </div>
      {added && (
        <p className="flex items-center gap-2 text-xs">
          <CheckCircle2 size={14} className="text-primary" />
          {t('expression.custom.added', { name: added })}
        </p>
      )}
    </div>
  )
}
