import { useTranslation } from 'react-i18next'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { SectionLabel } from '@/components/ui/section-label'
import { isServerMode } from '@/lib/api-client'
import { useLocalProfileStore } from '@/stores/local-profile-store'

const FIELDS = ['firstName', 'lastName', 'affiliation', 'orcid'] as const

/**
 * Static mode: the local profile (name, affiliation, ORCID) inline in a dialog
 * that records who did something, saved as typed. Renders nothing in server
 * mode, where the account's profile is used.
 */
export function LocalProfileFields({ fields = FIELDS }: { fields?: readonly (typeof FIELDS)[number][] }) {
  const { t } = useTranslation()
  const profile = useLocalProfileStore((s) => s.profile)
  const setProfile = useLocalProfileStore((s) => s.setProfile)
  if (isServerMode()) return null
  const labels: Record<(typeof FIELDS)[number], string> = {
    firstName: t('drafts.profile.first_name'),
    lastName: t('drafts.profile.last_name'),
    affiliation: t('drafts.profile.affiliation'),
    orcid: t('drafts.profile.orcid'),
  }
  return (
    <div className="space-y-2 rounded-md border p-3">
      <SectionLabel>{t('drafts.profile.title')}</SectionLabel>
      <p className="text-xs text-muted-foreground">{t('drafts.profile.description')}</p>
      <div className="grid grid-cols-2 gap-2">
        {fields.map((field) => (
          <FormField key={field} label={labels[field]}>
            {({ id }) => <Input id={id} value={profile[field]} onChange={(e) => setProfile({ [field]: e.target.value })} />}
          </FormField>
        ))}
      </div>
    </div>
  )
}
