import { useEffect, useMemo } from 'react'
import { overlayProjects, type Overlaid } from '@/lib/drafts/overlay'
import { useCatalogStore } from '@/stores/catalog-store'
import { useDraftsStore } from '@/stores/drafts-store'
import type { Project } from '@/lib/data'
import type { Resource } from '@/stores/catalog-store'

/**
 * The projects as this user sees them: the catalog with their drafts over it
 * (an edited project shows its draft, a new one is listed, one deleted in this
 * browser is hidden), plus the catalog resource for loading and error states.
 */
export function useProjectsView(): { resource: Resource<Project[]>; view: Overlaid<Project> } {
  const resource = useCatalogStore((s) => s.projects)
  const loadProjects = useCatalogStore((s) => s.loadProjects)
  const drafts = useDraftsStore((s) => s.drafts)
  const hidden = useDraftsStore((s) => s.hidden.project)
  const loadDrafts = useDraftsStore((s) => s.load)

  useEffect(() => {
    void loadProjects()
    void loadDrafts()
  }, [loadProjects, loadDrafts])

  const view = useMemo(() => overlayProjects(resource.data ?? [], drafts, hidden), [resource.data, drafts, hidden])
  return { resource, view }
}
