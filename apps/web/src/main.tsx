import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import i18n, { resolveLanguage } from '@/lib/i18n'
import '@/index.css'
import { App } from '@/app/App'
import { AuthGate } from '@/app/auth-gate'
import { AppErrorBoundary } from '@/components/layout/app-error-boundary'
import { ConfigErrorScreen } from '@/components/layout/config-error-screen'
import { isServerMode } from '@/lib/api-client'
import { loadStaticInstanceConfig } from '@/lib/config'
import { getDictionarySource, type InstanceInfo } from '@/lib/data'
import { setPasswordMinLength } from '@/lib/password-policy'
import { applyBranding } from '@/lib/theme'
import { useAppStore } from '@/stores/app-store'
import { useConfigStore } from '@/stores/config-store'

async function loadInstance(): Promise<InstanceInfo> {
  try {
    return await getDictionarySource().getInstance()
  } catch (error) {
    if (!isServerMode()) throw error
    // The API did not answer: boot on the bundled config.json so the auth gate can
    // say the server is unreachable, instead of a config error.
    console.warn('GET /api/v1/instance/config failed, using the bundled config.json', error)
    return { config: await loadStaticInstanceConfig(), server: null }
  }
}

async function boot() {
  const root = createRoot(document.getElementById('root')!)
  document.documentElement.classList.toggle('dark', useAppStore.getState().darkMode)

  try {
    const instance = await loadInstance()
    const { config } = instance
    applyBranding(config)
    useConfigStore.getState().setInstance(instance)
    if (instance.server) setPasswordMinLength(instance.server.passwordMinLength)
    await i18n.changeLanguage(
      resolveLanguage(useAppStore.getState().language, config.languages, config.defaultLanguage),
    )
  } catch (error) {
    console.error('Failed to load config.json', error)
    root.render(<ConfigErrorScreen error={error} />)
    return
  }

  root.render(
    <StrictMode>
      <AppErrorBoundary>
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <AuthGate>
            <App />
          </AuthGate>
        </BrowserRouter>
      </AppErrorBoundary>
    </StrictMode>,
  )
}

boot()
