import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { repositoryConfig, repositoryUrl } from '@/lib/data/forge'
import { canEdit } from '@/lib/drafts/permissions'
import { userHasPermission, useAuthStore } from '@/stores/auth-store'
import { useConfigStore, useInstanceConfig } from '@/stores/config-store'
import { useDraftsStore } from '@/stores/drafts-store'
import { defaultToolTag } from '@/features/export/export-settings'
import { todayIso, useEditorIdentity } from '@/features/drafts/identity'
import { newConceptSet, type MetadataFields } from '../lib/editing'
import { MetadataDialog } from './metadata-dialog'
import type { ConceptSetSummary } from '@/lib/data'

interface NewConceptSetButtonProps {
  /** The list as the user sees it: ids in use, category suggestions. */
  summaries: readonly ConceptSetSummary[]
}

/**
 * "New concept set": its metadata, then an empty draft (version 1.0.0, status
 * draft) whose page opens for adding concepts. The id is provisional in server
 * mode, where the server allocates the real one at submit.
 */
export function NewConceptSetButton({ summaries }: NewConceptSetButtonProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const config = useInstanceConfig()
  const server = useConfigStore((s) => s.server)
  const user = useAuthStore((s) => s.user)
  const { person, name } = useEditorIdentity()
  const saveDraft = useDraftsStore((s) => s.save)
  const newId = useDraftsStore((s) => s.newId)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!canEdit('concept-set', (p) => userHasPermission(user, p))) return null

  const create = async (values: Record<string, MetadataFields>) => {
    setBusy(true)
    setError(null)
    try {
      const id = await newId('concept-set', summaries.map((s) => s.id))
      const content = newConceptSet({
        id,
        values,
        person,
        authorName: name,
        organization: config.organization?.name ? { name: config.organization.name, url: config.organization.url ?? '' } : null,
        repoUrl: repositoryUrl(repositoryConfig(config)),
        toolTag: defaultToolTag(server?.appVersion),
        date: todayIso(),
        uniqueId: crypto.randomUUID(),
      })
      await saveDraft({ kind: 'concept-set', targetId: null, content })
      setOpen(false)
      navigate(`/concept-sets/${id}`)
    } catch (e) {
      console.error('Could not create the concept set', e)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus size={14} />
        {t('concept_sets.edit.new')}
      </Button>
      {error && <NoticeBanner tone="danger" title={t('drafts.save_failed')} description={error} />}
      <MetadataDialog open={open} onOpenChange={setOpen} conceptSet={null} summaries={summaries} onSubmit={create} busy={busy} />
    </>
  )
}
