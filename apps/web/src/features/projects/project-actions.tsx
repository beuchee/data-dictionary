import type { Project } from '@/lib/data'

interface ProjectActionsProps {
  project: Project
}

/**
 * The buttons on a project's title row.
 *
 * TODO(v2-phase-1): the Export action (CSV and JSON of the pinned concept sets)
 * goes here; its dialog is built separately.
 */
export function ProjectActions({ project: _project }: ProjectActionsProps) {
  return null
}
