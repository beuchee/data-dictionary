import { create } from 'zustand'
import type { SubmitResult } from '@/lib/drafts/types'

interface SubmitResultState {
  result: SubmitResult | null
  show: (result: SubmitResult) => void
  close: () => void
}

/**
 * The outcome of the last submit, held outside the page that submitted: a commit
 * reloads the catalogue, which unmounts that page (and its submit dialog) while
 * it loads, so a result kept there would vanish with the proposal link or SHA.
 */
export const useSubmitResultStore = create<SubmitResultState>()((set) => ({
  result: null,
  show: (result) => set({ result }),
  close: () => set({ result: null }),
}))
