import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitFork } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { canEdit } from '@/lib/drafts/permissions'
import { userHasPermission, useAuthStore } from '@/stores/auth-store'
import { ImportDialog } from './import-dialog'
import type { ConceptSetSummary } from '@/lib/data'

interface ImportButtonProps {
  summaries: readonly ConceptSetSummary[]
  lang: string
}

/** The list page's "Import from another repository" (editors). */
export function ImportButton({ summaries, lang }: ImportButtonProps) {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.user)
  const [open, setOpen] = useState(false)
  if (!canEdit('concept-set', (p) => userHasPermission(user, p))) return null
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <GitFork size={14} />
        {t('cross_repo_import.button')}
      </Button>
      {open && <ImportDialog open={open} onOpenChange={setOpen} summaries={summaries} lang={lang} />}
    </>
  )
}
