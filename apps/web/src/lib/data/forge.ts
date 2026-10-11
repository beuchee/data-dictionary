// Ported from legacy/app.js (repoConfig, forgeOrigin, forgeName, repoSlug, repoRawBase).
import type { InstanceConfig } from '@/lib/config'

export type RepositoryConfig = NonNullable<InstanceConfig['repository']>
export type ForgeName = 'GitHub' | 'GitLab'

/** The `repository` block, or its pre-v1.2.6 name `github`, so older forks keep working. */
export function repositoryConfig(config: Pick<InstanceConfig, 'repository' | 'github'>): RepositoryConfig {
  return config.repository ?? config.github ?? {}
}

/**
 * Origin of THIS repo's forge (`https://gitlab.com`), from `repository.url`.
 * Never from `upstream`: a GitLab fork keeps a github.com upstream, and reading
 * it sent every past-version fetch to the wrong host. Defaults to GitHub.
 */
export function forgeOrigin(repo: RepositoryConfig): string {
  const m = /^(https?:\/\/[^/]+)/.exec(String(repo.url ?? ''))
  return m ? m[1] : 'https://github.com'
}

/**
 * `forge` when declared, else GitHub for github.com and GitLab for any other
 * host (the only other forge supported; a self-hosted instance whose domain says
 * nothing should declare `forge`).
 */
export function forgeName(repo: RepositoryConfig): ForgeName {
  const declared = repo.forge ?? ''
  if (/^gitlab$/i.test(declared)) return 'GitLab'
  if (/^github$/i.test(declared)) return 'GitHub'
  return /(^|\.)github\.com$/i.test(forgeOrigin(repo).replace(/^https?:\/\//, '')) ? 'GitHub' : 'GitLab'
}

/** Full URL of this repo, without `.git` or trailing slash; '' when nothing identifies it. */
export function repositoryUrl(repo: RepositoryConfig): string {
  if (repo.url) return String(repo.url).replace(/\.git$/, '').replace(/\/+$/, '')
  if (repo.repo) return `${forgeOrigin(repo)}/${repo.repo}`
  // Last resort: `upstream` is the project this fork came from, not the fork.
  if (repo.upstream) return String(repo.upstream).replace(/\.git$/, '')
  return ''
}

/**
 * `<owner>/<project>` (GitLab subgroups included), from `repo` or else derived
 * from the URL: a fork setting only the URL used to get an empty slug and
 * `https://gitlab.com//-/…` links.
 */
export function repositorySlug(repo: RepositoryConfig): string {
  if (repo.repo) return String(repo.repo).replace(/^\/+|\/+$/g, '')
  return repositoryUrl(repo)
    .replace(/^https?:\/\/[^/]+\/?/, '')
    .replace(/\/+$/, '')
}

/**
 * Base URL serving the repository tree at commit `sha` (ends with `/`), or null
 * when the repo can't be addressed. GitHub serves raw files from a separate host;
 * GitLab (gitlab.com or self-hosted) under `/-/raw/` on the repo's own origin.
 */
export function repoRawBase(repo: RepositoryConfig, sha: string): string | null {
  const slug = repositorySlug(repo)
  if (!slug || !/^[0-9a-f]{7,64}$/.test(sha)) return null
  if (forgeName(repo) === 'GitLab') return `${forgeOrigin(repo)}/${slug}/-/raw/${sha}/`
  return `https://raw.githubusercontent.com/${slug}/${sha}/`
}
