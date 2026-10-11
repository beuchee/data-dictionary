import { parse, type Config } from '@data-dictionary/format'
import { apiFetch, isServerMode } from '@/lib/api-client'
import { getDictionarySource } from '@/lib/data'
import { applyBranding } from '@/lib/theme'
import { useConfigStore } from '@/stores/config-store'

/**
 * config.json exactly as the repository holds it (not the normalized boot
 * config, which fills in defaults): what a `config` draft must start from.
 */
export async function loadRawConfig(): Promise<Config> {
  if (isServerMode()) {
    const res = await apiFetch('/api/v1/instance/config')
    if (!res.ok) throw new Error(`/instance/config: HTTP ${res.status}`)
    return parse<{ config: Config }>(await res.text()).config
  }
  const res = await fetch(`${import.meta.env.BASE_URL}config.json`, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`config.json: HTTP ${res.status}`)
  return parse<Config>(await res.text())
}

/** Reloads the instance after a committed config change: new name, colors and logo right away. */
export async function refreshInstance(): Promise<void> {
  try {
    const instance = await getDictionarySource().getInstance()
    useConfigStore.getState().setInstance(instance)
    applyBranding(instance.config)
  } catch (error) {
    console.warn('Could not reload the instance config', error)
  }
}
