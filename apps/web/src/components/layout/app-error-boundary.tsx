// Adapted from linkr@1310cf4a4 apps/web/src/components/layout/AppErrorBoundary.tsx (theme tokens,
// i18n, clears only this app's dd- keys).
import { Component, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import i18n from '@/lib/i18n'
import { clearLocalData } from '@/lib/local-data'

interface AppErrorBoundaryProps {
  children: ReactNode
}

interface AppErrorBoundaryState {
  error: Error | null
}

/** Last line of defence: a render crash shows a way out instead of a blank page. */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('Unhandled render error', error)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const t = i18n.t.bind(i18n)
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <EmptyState
          icon={TriangleAlert}
          title={t('layout.boot.error_title')}
          description={
            <>
              {t('layout.boot.error_description')}
              <code className="mt-2 block break-all text-[10px]">{error.message}</code>
            </>
          }
          action={
            <div className="flex justify-center gap-2">
              <Button variant="outline" onClick={() => window.location.reload()}>
                {t('layout.boot.reload')}
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive">{t('layout.boot.clear_and_reload')}</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t('layout.boot.clear_confirm_title')}</AlertDialogTitle>
                    <AlertDialogDescription>{t('layout.boot.clear_confirm_description')}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={() => {
                        clearLocalData()
                        window.location.reload()
                      }}
                    >
                      {t('layout.boot.clear_and_reload')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          }
        />
      </div>
    )
  }
}
