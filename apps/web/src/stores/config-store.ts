import { create } from 'zustand'
import type { InstanceConfig } from '@/lib/config'
import type { InstanceInfo, ServerCapabilities } from '@/lib/data'

interface ConfigState {
  config: InstanceConfig | null
  /** What the API offers; null in static mode or when the API did not answer at boot. */
  server: ServerCapabilities | null
  setInstance: (instance: InstanceInfo) => void
}

/** The instance config, loaded once at boot (main.tsx) before the app renders. */
export const useConfigStore = create<ConfigState>()((set) => ({
  config: null,
  server: null,
  setInstance: ({ config, server }) => set({ config, server }),
}))

export function useInstanceConfig(): InstanceConfig {
  const config = useConfigStore((s) => s.config)
  if (!config) throw new Error('Instance config used before boot loaded it')
  return config
}

/**
 * Whether pages are readable without logging in. Static mode is public by nature;
 * in server mode the API's answer wins over config.json (it reads the live content).
 */
export function anonymousReadAllowed(state: Pick<ConfigState, 'config' | 'server'>): boolean {
  if (state.server) return state.server.anonymousRead
  return state.config?.access?.anonymousRead !== false
}
