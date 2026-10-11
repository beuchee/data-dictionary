import { appName, type InstanceConfig } from '@/lib/config'
import { forgeName, repositoryConfig, repositorySlug, repositoryUrl } from '@/lib/data/forge'

/** The values a documentation page may reference as `{{name}}`. */
export type DocVariables = Readonly<Record<string, string>>

/**
 * The instance-specific values the documentation shows, from `config.json`.
 * Defaults mirror v1's (`legacy/documentation.js`): an unset custom vocabulary
 * reads `CUSTOM`, an unset organization name `Your Organization`, and an unset
 * organization URL stays empty rather than showing a URL the fork never set.
 */
export function docVariables(config: InstanceConfig): DocVariables {
  const repo = repositoryConfig(config)
  const url = repositoryUrl(repo)
  const branch = repo.branch?.trim() || 'main'
  const forge = forgeName(repo)
  return {
    'app.name': appName(config),
    'organization.name': config.organization?.name?.trim() || 'Your Organization',
    'organization.url': config.organization?.url?.trim() || '',
    'customVocabulary.id': config.customVocabulary?.id?.trim() || 'CUSTOM',
    'customVocabulary.codePrefix': config.customVocabulary?.codePrefix?.trim() || '',
    'forge.name': forge,
    'repository.url': url,
    'repository.slug': repositorySlug(repo),
    'repository.branch': branch,
    // Where a file of the default branch is shown: GitLab nests it under `/-/`.
    'repository.blobUrl': url ? `${url}${forge === 'GitLab' ? '/-' : ''}/blob/${branch}` : '',
  }
}

const PLACEHOLDER = /\{\{\s*([A-Za-z][\w.]*)\s*\}\}/g

/**
 * `text` with each `{{name}}` replaced by its value. An unknown name is left as
 * written, so a typo shows on the page (and fails the docs test) instead of
 * silently vanishing.
 */
export function substitutePlaceholders(text: string, variables: DocVariables): string {
  return text.replace(PLACEHOLDER, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(variables, name) ? variables[name] : match,
  )
}

/** The distinct placeholder names used in `text`, in order of appearance. */
export function placeholderNames(text: string): string[] {
  return [...new Set(Array.from(text.matchAll(PLACEHOLDER), (m) => m[1]))]
}
