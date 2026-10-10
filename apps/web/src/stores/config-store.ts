import { create } from 'zustand'
import type { InstanceConfig } from '@/lib/config'

interface ConfigState {
  config: InstanceConfig | null
  setConfig: (config: InstanceConfig) => void
}

/** The instance config, loaded once at boot (main.tsx) before the app renders. */
export const useConfigStore = create<ConfigState>((set) => ({
  config: null,
  setConfig: (config) => set({ config }),
}))

export function useInstanceConfig(): InstanceConfig {
  const config = useConfigStore((s) => s.config)
  if (!config) throw new Error('Instance config used before boot loaded it')
  return config
}
