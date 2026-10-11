import { serialize, type Project } from '@data-dictionary/format'

/** A project as its `projects/{id}.json` file: v1's `JSON.stringify(project, null, 2)` plus a final newline. */
export function buildProjectJson(project: Project): string {
  return serialize(project, { kind: 'project' })
}
