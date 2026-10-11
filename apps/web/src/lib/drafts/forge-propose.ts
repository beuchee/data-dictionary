// Ported from legacy/app.js (forgePath, forgeFileUrl, FORGE_PREFILL_MAX, proposeOnForge).
import { forgeName, forgeOrigin, repositorySlug, type RepositoryConfig } from '@/lib/data/forge'

/**
 * A prefilled "create file" URL is a GET, so the whole JSON travels in the
 * query string. Browsers and forge front-ends cap that (practically ~8 KB);
 * past the cap the request is rejected or truncated, which would silently
 * commit a broken file. Above this the create page opens unprefilled and the
 * content goes through the clipboard, like an edit.
 */
export const FORGE_PREFILL_MAX = 6000

/**
 * An `/edit/`, `/blob/` or `/new/` URL for `filePath` at `branch`. GitLab
 * namespaces repository routes under `/-/`, GitHub does not.
 */
export function forgePath(repo: RepositoryConfig, kind: 'edit' | 'blob' | 'new', branch: string, filePath: string): string {
  const infix = forgeName(repo) === 'GitLab' ? '/-/' : '/'
  return `${forgeOrigin(repo)}/${repositorySlug(repo)}${infix}${kind}/${branch}/${filePath.replace(/^\//, '')}`
}

export interface ForgeFileUrl {
  url: string
  /** The content rides in the URL: nothing to paste. */
  prefilled: boolean
}

/**
 * Where to propose `filePath` on the forge. `/edit/` only opens a file that
 * already exists on the branch, so a file created here goes to the "new file"
 * route instead (an edit URL would 404). Only that route accepts content (both
 * forges ignore it on `/edit/`, which loads the committed file), so an edit
 * always goes through the clipboard.
 */
export function forgeFileUrl(
  repo: RepositoryConfig,
  filePath: string,
  options: { isNew: boolean; content?: string },
): ForgeFileUrl {
  const branch = repo.branch || 'main'
  const path = filePath.replace(/^\//, '')
  if (!options.isNew) return { url: forgePath(repo, 'edit', branch, path), prefilled: false }

  const isGitLab = forgeName(repo) === 'GitLab'
  // GitLab hangs the target path off the URL and names the params file_name /
  // content; GitHub takes the path in `filename` and the body in `value`.
  const base = isGitLab
    ? `${forgeOrigin(repo)}/${repositorySlug(repo)}/-/new/${branch}/`
    : `${forgeOrigin(repo)}/${repositorySlug(repo)}/new/${branch}`
  const params = `${isGitLab ? 'file_name' : 'filename'}=${encodeURIComponent(path)}`
  const content = options.content ?? ''
  if (content) {
    const withContent = `${base}?${params}&${isGitLab ? 'content' : 'value'}=${encodeURIComponent(content)}`
    if (withContent.length <= FORGE_PREFILL_MAX) return { url: withContent, prefilled: true }
  }
  return { url: `${base}?${params}`, prefilled: false }
}

/** The steps the propose dialog walks through, as i18n keys of the `drafts` namespace. */
export type ProposeStep =
  | 'step_create'
  | 'step_create_prefilled'
  | 'step_too_large'
  | 'step_create_paste'
  | 'step_update'
  | 'step_copied'
  | 'step_open_existing'
  | 'step_replace_all'
  | 'step_commit'
  | 'step_commit_branch'

/**
 * v1's explanation of the hand-off: a create opens an editor already holding
 * the JSON (or, too large for the URL, an empty one to paste into), an update
 * opens the existing file where the paste must replace everything.
 */
export function proposeSteps(target: { isNew: boolean; prefilled: boolean }): ProposeStep[] {
  if (target.isNew && target.prefilled) return ['step_create', 'step_create_prefilled', 'step_commit']
  if (target.isNew) return ['step_create', 'step_too_large', 'step_create_paste', 'step_commit_branch']
  return ['step_update', 'step_copied', 'step_open_existing', 'step_replace_all', 'step_commit_branch']
}
