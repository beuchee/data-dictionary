import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Person } from '@data-dictionary/format'

interface LocalProfileState {
  /** Static mode has no accounts: who edits and reviews here, as v1's "Guest" profile. */
  profile: Required<{ [K in 'firstName' | 'lastName' | 'affiliation' | 'profession' | 'orcid']: string }>
  setProfile: (profile: Partial<Person>) => void
}

export const useLocalProfileStore = create<LocalProfileState>()(
  persist(
    (set, get) => ({
      profile: { firstName: '', lastName: '', affiliation: '', profession: '', orcid: '' },
      setProfile: (changes) => {
        const next = { ...get().profile }
        for (const key of Object.keys(next) as (keyof typeof next)[]) {
          const value = changes[key]
          if (typeof value === 'string') next[key] = value.trim()
        }
        set({ profile: next })
      },
    }),
    { name: 'dd-local-profile', partialize: (s) => ({ profile: s.profile }) },
  ),
)
