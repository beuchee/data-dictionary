import { useCallback } from 'react'
import { isServerMode } from '@/lib/api-client'
import { repositoryConfig, repositoryUrl } from '@/lib/data/forge'
import { useAuthStore, type AuthUser } from '@/stores/auth-store'
import { useInstanceConfig } from '@/stores/config-store'
import { useLocalProfileStore } from '@/stores/local-profile-store'
import type { Person } from '@data-dictionary/format'
import type { EditStamp } from '@/lib/export/provenance'

/** A concept set's `createdByDetails` / review `reviewer` from an account's profile. */
export function personFromUser(user: AuthUser | null): Person {
  return {
    firstName: user?.first_name ?? '',
    lastName: user?.last_name ?? '',
    affiliation: user?.affiliation ?? '',
    profession: user?.profession ?? '',
    orcid: user?.orcid ?? '',
  }
}

/** "First Last", empty when neither is set. */
export function personName(person: Person): string {
  return [person.firstName, person.lastName]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(' ')
}

/** Today as `YYYY-MM-DD` (UTC, as v1 stamped it). */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Who is editing: the signed-in account's profile (server mode) or this
 * browser's local profile (static mode). `name` is empty until a name is set.
 */
export function useEditorIdentity(): { person: Person; name: string } {
  const user = useAuthStore((s) => s.user)
  const local = useLocalProfileStore((s) => s.profile)
  const person = isServerMode() ? personFromUser(user) : { ...local }
  return { person, name: personName(person) || (isServerMode() ? (user?.username ?? '') : '') }
}

/** Builds the provenance stamp of an edit made now, by this user, in this instance. */
export function useEditStamp(): () => EditStamp {
  const config = useInstanceConfig()
  const { name } = useEditorIdentity()
  return useCallback(
    () => ({
      date: todayIso(),
      modifiedBy: name,
      repoUrl: repositoryUrl(repositoryConfig(config)),
      organization: config.organization?.name ? { name: config.organization.name, url: config.organization.url ?? '' } : null,
    }),
    [config, name],
  )
}
