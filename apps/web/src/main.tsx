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
import { ConfigErrorScreen } from '@/components/layout/config-error-screen'
import { loadInstanceConfig } from '@/lib/config'
import { applyBranding } from '@/lib/theme'
import { useAppStore } from '@/stores/app-store'
import { useConfigStore } from '@/stores/config-store'

async function boot() {
  const root = createRoot(document.getElementById('root')!)
  document.documentElement.classList.toggle('dark', useAppStore.getState().darkMode)

  try {
    const config = await loadInstanceConfig()
    applyBranding(config)
    useConfigStore.getState().setConfig(config)
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
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <App />
      </BrowserRouter>
    </StrictMode>,
  )
}

boot()
