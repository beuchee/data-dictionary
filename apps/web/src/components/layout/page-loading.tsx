// Adapted from linkr@1310cf4a4 apps/web/src/components/layout/PageLoading.tsx
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'

/** What the main area shows while a lazy page's chunk downloads. */
export function PageLoading() {
  const { t } = useTranslation()

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <Loader2 size={24} className="animate-spin text-muted-foreground" />
      {/* Faded in late: a spinner flashing for 80ms on a cached chunk is noise. */}
      <p className="animate-in fade-in text-xs text-muted-foreground opacity-0 [animation-delay:400ms] [animation-duration:200ms] [animation-fill-mode:forwards]">
        {t('boot.loading_page')}
      </p>
    </div>
  )
}
