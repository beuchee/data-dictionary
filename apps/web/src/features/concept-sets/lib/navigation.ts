import { useTranslation } from 'react-i18next'

// The list's query string when the user last left it, so the detail page's
// breadcrumb returns to the same filters. In memory: a reload starts afresh.
let lastListSearch = ''

export function rememberListSearch(search: string): void {
  lastListSearch = search
}

export function listPath(): string {
  return `/concept-sets${lastListSearch ? `?${lastListSearch.replace(/^\?/, '')}` : ''}`
}

/** The language content is shown in: the UI language, with no fallback to another. */
export function useContentLanguage(): string {
  const { i18n } = useTranslation()
  return i18n.language
}

export const DETAIL_TABS = ['concepts', 'comments', 'statistics', 'reviews'] as const
export type DetailTab = (typeof DETAIL_TABS)[number]

/** `?tab=`; v1 called the reviews tab `review`. */
export function parseDetailTab(raw: string | null): DetailTab {
  if (raw === 'review') return 'reviews'
  return (DETAIL_TABS as readonly string[]).includes(raw ?? '') ? (raw as DetailTab) : 'concepts'
}

/** A version can be shown when it is current, or was snapshotted (a commit is indexed). */
export function isReachable(v: { isCurrent: boolean; commit: string | null }): boolean {
  return v.isCurrent || v.commit !== null
}
