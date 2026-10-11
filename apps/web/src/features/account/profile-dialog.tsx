import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DialogShell } from '@/components/ui/dialog-shell'
import { FieldError } from '@/components/ui/field-error'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { ApiError } from '@/lib/api-client'
import { validationErrorFields } from '@/lib/api-errors'
import { useAuthStore, type AuthUser, type ProfileChanges } from '@/stores/auth-store'

interface ProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const FIELDS = ['firstName', 'lastName', 'email', 'affiliation', 'profession', 'orcid'] as const
type Field = (typeof FIELDS)[number]

const FROM_USER: Record<Field, keyof AuthUser> = {
  firstName: 'first_name',
  lastName: 'last_name',
  email: 'email',
  affiliation: 'affiliation',
  profession: 'profession',
  orcid: 'orcid',
}

const LABEL_KEY: Record<Field, string> = {
  firstName: 'auth.profile.first_name',
  lastName: 'auth.profile.last_name',
  email: 'auth.profile.email',
  affiliation: 'auth.profile.affiliation',
  profession: 'auth.profile.profession',
  orcid: 'auth.profile.orcid',
}

function initialValues(user: AuthUser | null): Record<Field, string> {
  return Object.fromEntries(FIELDS.map((f) => [f, String(user?.[FROM_USER[f]] ?? '')])) as Record<Field, string>
}

/** The signed-in user's own profile (PATCH /auth/me): what becomes `createdByDetails` and review authorship. */
export function ProfileDialog({ open, onOpenChange }: ProfileDialogProps) {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.user)
  const updateProfile = useAuthStore((s) => s.updateProfile)
  const [values, setValues] = useState(() => initialValues(user))
  const [saving, setSaving] = useState(false)
  const [orcidError, setOrcidError] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const initial = initialValues(user)
  const dirty = FIELDS.some((f) => values[f].trim() !== initial[f])

  // Opening is driven by the parent; closing resets the form to the saved profile.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setValues(initialValues(useAuthStore.getState().user))
      setOrcidError(false)
      setError(null)
    }
    onOpenChange(next)
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setOrcidError(false)
    try {
      const changes: ProfileChanges = {}
      for (const f of FIELDS) changes[f] = values[f].trim() || null
      await updateProfile(changes)
      handleOpenChange(false)
    } catch (e) {
      if (e instanceof ApiError && e.status === 422 && validationErrorFields(e.message).includes('orcid')) {
        setOrcidError(true)
      } else {
        setError(t('auth.profile.error'))
      }
    } finally {
      setSaving(false)
    }
  }

  const field = (f: Field, extra?: { hint?: string; type?: string; autoComplete?: string }) => (
    <FormField label={t(LABEL_KEY[f])} hint={extra?.hint}>
      {({ id }) => (
        <div className="space-y-1.5">
          <Input
            id={id}
            type={extra?.type}
            autoComplete={extra?.autoComplete}
            value={values[f]}
            onChange={(e) => {
              setValues((v) => ({ ...v, [f]: e.target.value }))
              if (f === 'orcid') setOrcidError(false)
            }}
            aria-invalid={(f === 'orcid' && orcidError) || undefined}
          />
          {f === 'orcid' && <FieldError message={orcidError ? t('auth.profile.orcid_invalid') : null} />}
        </div>
      )}
    </FormField>
  )

  return (
    <DialogShell
      open={open}
      onOpenChange={handleOpenChange}
      title={t('auth.profile.title')}
      description={t('auth.profile.description')}
      onConfirm={handleSave}
      confirmLabel={t('common.save')}
      confirmDisabled={!dirty}
      dirtyTracked
      busy={saving}
    >
      <div className="grid grid-cols-2 gap-4">
        {field('firstName', { autoComplete: 'given-name' })}
        {field('lastName', { autoComplete: 'family-name' })}
      </div>
      {field('email', { type: 'email', autoComplete: 'email' })}
      {field('affiliation', { autoComplete: 'organization' })}
      {field('profession')}
      {field('orcid', { hint: t('auth.profile.orcid_hint') })}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </DialogShell>
  )
}
