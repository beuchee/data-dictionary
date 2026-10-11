import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DialogShell } from '@/components/ui/dialog-shell'
import { FieldError } from '@/components/ui/field-error'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useInstanceConfig } from '@/stores/config-store'
import { useEditorIdentity } from '@/features/drafts/identity'
import { projectNameTaken, type ProjectDetails } from '../lib/project-editing'
import type { Project } from '@/lib/data'

interface ProjectDetailsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null: create a project. */
  project: Project | null
  /** Every project the user sees, for the name check. */
  projects: readonly Project[]
  onSubmit: (details: ProjectDetails) => void | Promise<void>
  busy?: boolean
}

/** A project's name and short description in each language, and its author. Names are unique across projects. */
export function ProjectDetailsDialog({ open, onOpenChange, project, projects, onSubmit, busy }: ProjectDetailsDialogProps) {
  const { t, i18n } = useTranslation()
  const config = useInstanceConfig()
  const { name: me } = useEditorIdentity()
  const languages = config.languages
  const required = languages.includes(i18n.language) ? i18n.language : config.defaultLanguage
  const [tab, setTab] = useState(required)
  const [details, setDetails] = useState<ProjectDetails>({ texts: {}, createdBy: '' })
  const [submitted, setSubmitted] = useState(false)

  // Reset when the dialog opens.
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setDetails({
        texts: Object.fromEntries(
          languages.map((l) => [l, { name: project?.translations?.[l]?.name ?? '', shortDescription: project?.translations?.[l]?.shortDescription ?? '' }]),
        ),
        createdBy: project ? (project.createdBy ?? '') : me,
      })
      setTab(required)
      setSubmitted(false)
    }
  }

  const problems = (lang: string): string | null => {
    const name = details.texts[lang]?.name ?? ''
    if (lang === required && !name.trim()) return t('projects.edit.name_required')
    if (projectNameTaken(projects, name, project?.id ?? null)) return t('projects.edit.name_taken')
    return null
  }
  const invalid = languages.find((l) => problems(l))

  const setText = (lang: string, field: 'name' | 'shortDescription', value: string) =>
    setDetails((d) => ({ ...d, texts: { ...d.texts, [lang]: { ...d.texts[lang], [field]: value } } }))

  const confirm = () => {
    setSubmitted(true)
    if (invalid) {
      setTab(invalid)
      return
    }
    void onSubmit(details)
  }

  const fields = (lang: string) => (
    <div className="space-y-3">
      <FormField label={t('projects.edit.name')} required={lang === required}>
        {({ id }) => (
          <>
            <Input id={id} value={details.texts[lang]?.name ?? ''} onChange={(e) => setText(lang, 'name', e.target.value)} autoFocus={lang === required} />
            <FieldError message={submitted ? problems(lang) : null} />
          </>
        )}
      </FormField>
      <FormField label={t('projects.edit.short_description')}>
        {({ id }) => (
          <Input id={id} value={details.texts[lang]?.shortDescription ?? ''} onChange={(e) => setText(lang, 'shortDescription', e.target.value)} />
        )}
      </FormField>
    </div>
  )

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      kind="settings"
      title={project ? t('projects.edit.details_title') : t('projects.edit.create_title')}
      onConfirm={confirm}
      confirmLabel={project ? t('projects.edit.apply') : t('projects.edit.create')}
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
      <FormField label={t('projects.edit.author')}>
        {({ id }) => <Input id={id} value={details.createdBy} onChange={(e) => setDetails((d) => ({ ...d, createdBy: e.target.value }))} />}
      </FormField>
    </DialogShell>
  )
}
