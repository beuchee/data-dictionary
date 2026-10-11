import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ExportConceptSetDialog } from '@/features/export'
import { resolvedKey, useCatalogStore } from '@/stores/catalog-store'
import { conceptSetPermalink } from '../lib/navigation'
import type { ConceptSet } from '@data-dictionary/format'

interface ExportButtonProps {
  conceptSet: ConceptSet
  /** The past version shown, if any; the current one otherwise. */
  version?: string
  lang: string
}

/** "Export" on the detail page: INDICATE JSON, ATLAS JSON or OMOP SQL of the set as shown. */
export function ExportButton({ conceptSet, version, lang }: ExportButtonProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const recommendedUnits = useCatalogStore((s) => s.recommendedUnits.data)
  const unitConversions = useCatalogStore((s) => s.unitConversions.data)
  const loadRecommendedUnits = useCatalogStore((s) => s.loadRecommendedUnits)
  const loadUnitConversions = useCatalogStore((s) => s.loadUnitConversions)
  const loadResolved = useCatalogStore((s) => s.loadResolved)

  useEffect(() => {
    if (!open) return
    void loadRecommendedUnits()
    void loadUnitConversions()
  }, [open, loadRecommendedUnits, loadUnitConversions])

  const resolved = async () => {
    const query = { version }
    await loadResolved(conceptSet.id, query)
    const resource = useCatalogStore.getState().resolved[resolvedKey(conceptSet.id, query)]
    if (resource?.status === 'error') throw new Error(resource.error ?? 'resolved')
    return resource?.data?.resolvedConcepts ?? null
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Download size={14} />
        {t('concept_sets.edit.export')}
      </Button>
      {open && (
        <ExportConceptSetDialog
          open={open}
          onOpenChange={setOpen}
          conceptSet={conceptSet}
          loadResolved={resolved}
          recommendedUnits={recommendedUnits ?? []}
          unitConversions={unitConversions ?? []}
          lang={lang}
          permalink={conceptSetPermalink(conceptSet.id, version ?? conceptSet.version)}
        />
      )}
    </>
  )
}
