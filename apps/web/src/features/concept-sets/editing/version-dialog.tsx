import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { FieldError } from '@/components/ui/field-error'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { bumpVersion, newVersionProblem, suggestBump, type BumpType } from '@/lib/drafts/semver'
import { cn } from '@/lib/utils'
import { todayIso, useEditorIdentity } from '@/features/drafts/identity'
import { LocalProfileFields } from '@/features/drafts/local-profile-fields'
import type { ConceptSet } from '@data-dictionary/format'
import type { VersionBump } from '../lib/editing'

interface VersionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  working: ConceptSet
  /** The repository's current version of the set; null for a set created here. */
  base: ConceptSet | null
  /** Every version already published (the index and the set's history): never reused. */
  published: readonly string[]
  onApply: (bump: VersionBump) => void
}

const BUMPS: BumpType[] = ['major', 'minor', 'patch']

/**
 * A new semantic version for the edited set: the bump the changes call for is
 * suggested (major when concepts can be lost, minor when only added, patch
 * otherwise), each button showing the number it gives; a message and the
 * author go into `metadata.versions`.
 */
export function VersionDialog({ open, onOpenChange, working, base, published, onApply }: VersionDialogProps) {
  const { t } = useTranslation()
  const { name } = useEditorIdentity()
  const from = base?.version ?? working.version
  const suggested = useMemo(() => (base ? suggestBump(base, working) : 'patch'), [base, working])
  const [version, setVersion] = useState('')
  const [message, setMessage] = useState('')
  const [author, setAuthor] = useState('')
  const [submitted, setSubmitted] = useState(false)

  // Reset when the dialog opens.
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setVersion(bumpVersion(from, suggested))
      setMessage('')
      setAuthor(name)
      setSubmitted(false)
    }
  }

  const problem = newVersionProblem(version, from, base ? published : [])
  const confirm = () => {
    setSubmitted(true)
    if (problem) return
    onApply({ version: version.trim(), date: todayIso(), author: author.trim() || name, message })
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      kind="settings"
      title={t('concept_sets.edit.version_title')}
      description={t('concept_sets.edit.version_description', { version: from })}
      onConfirm={confirm}
      confirmLabel={t('concept_sets.edit.version_apply')}
    >
      <div className="grid grid-cols-3 gap-1.5">
        {BUMPS.map((type) => {
          const value = bumpVersion(from, type)
          return (
            <Button
              key={type}
              type="button"
              variant="outline"
              onClick={() => setVersion(value)}
              className={cn('h-auto flex-col gap-0 py-1.5', version === value && 'border-primary bg-primary/5')}
            >
              <span className="flex items-center gap-1 font-medium">
                {t(`concept_sets.edit.bump_${type}`)}
                {type === suggested && <Badge size="xs">{t('concept_sets.edit.suggested')}</Badge>}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">{value}</span>
            </Button>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">{t(`concept_sets.edit.bump_hint_${suggested}`)}</p>
      <FormField label={t('concept_sets.edit.new_version')} required>
        {({ id }) => (
          <>
            <Input id={id} value={version} onChange={(e) => setVersion(e.target.value)} className="font-mono" />
            <FieldError message={submitted && problem ? t(`concept_sets.edit.version_${problem}`, { version: from }) : null} />
          </>
        )}
      </FormField>
      <FormField label={t('concept_sets.edit.version_message')}>
        {({ id }) => <Textarea id={id} value={message} onChange={(e) => setMessage(e.target.value)} rows={3} />}
      </FormField>
      <FormField label={t('concept_sets.edit.version_author')}>
        {({ id }) => <Input id={id} value={author} onChange={(e) => setAuthor(e.target.value)} />}
      </FormField>
      {!name && <LocalProfileFields fields={['firstName', 'lastName']} />}
    </DialogShell>
  )
}
