import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AppState {
  darkMode: boolean
  /** `null` until the user picks one: the instance's defaultLanguage applies. */
  language: string | null
  toggleDarkMode: () => void
  setLanguage: (language: string) => void
}

function prefersDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      darkMode: prefersDark(),
      language: null,
      toggleDarkMode: () => set((s) => ({ darkMode: !s.darkMode })),
      setLanguage: (language) => set({ language }),
    }),
    {
      name: 'dd-preferences',
      partialize: (s) => ({ darkMode: s.darkMode, language: s.language }),
    },
  ),
)
