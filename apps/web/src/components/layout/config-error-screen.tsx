import { useTranslation } from 'react-i18next'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'

interface ConfigErrorScreenProps {
  error: unknown
}

export function ConfigErrorScreen({ error }: ConfigErrorScreenProps) {
  const { t } = useTranslation()
  const detail = error instanceof Error ? error.message : String(error)

  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <EmptyState
        icon={TriangleAlert}
        title={t('boot.config_error_title')}
        description={
          <>
            {t('boot.config_error_description')}
            <code className="mt-2 block break-all text-[10px]">{detail}</code>
          </>
        }
        action={
          <Button variant="outline" onClick={() => window.location.reload()}>
            {t('boot.retry')}
          </Button>
        }
      />
    </div>
  )
}
