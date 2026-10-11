import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { copyText } from '@/lib/clipboard'
import { forgeName, repositoryConfig } from '@/lib/data/forge'
import { forgeFileUrl } from '@/lib/drafts/forge-propose'
import { useInstanceConfig } from '@/stores/config-store'
import { serialize, type ConceptSet } from '@data-dictionary/format'
import { liveExpression, useLiveResolution } from './live-resolution'

interface ResolvedFileNoticeProps {
  /** The set being proposed. */
  content: ConceptSet
  /** The repository's version (null for a new set). */
  base: ConceptSet | null
  isNew: boolean
}

/**
 * Static mode, proposing a concept set whose expression changed: its resolved
 * list (`concept_sets_resolved/{id}.json`) must change too, and CI does not
 * regenerate it (v1 told the user to run resolve.py). Offers that file,
 * resolved here with the loaded vocabulary, as a second file to propose;
 * without a vocabulary, says to run resolve.py.
 */
export function ResolvedFileNotice({ content, base, isNew }: ResolvedFileNoticeProps) {
  const { t } = useTranslation()
  const config = useInstanceConfig()
  const repo = repositoryConfig(config)
  const items = liveExpression(content.expression?.items, base?.expression?.items, base !== null)
  const entry = useLiveResolution(content.id, items)
  const [copied, setCopied] = useState(false)
  if (!items) return null

  const path = `concept_sets_resolved/${content.id}.json`
  const ready = entry?.status === 'ready' ? entry.result : null
  const copyAndOpen = async () => {
    if (!ready) return
    const text = serialize({ conceptSetId: content.id, vocabularyVersion: ready.vocabularyVersion, resolvedConcepts: ready.resolvedConcepts }, { trailingNewline: false })
    const ok = await copyText(text)
    setCopied(ok)
    const opened = window.open(forgeFileUrl(repo, path, { isNew }).url, '_blank')
    if (opened) opened.opener = null
  }

  return (
    <NoticeBanner
      tone="warning"
      title={t('expression.resolved_file_title', { path })}
      description={
        ready
          ? t('expression.resolved_file_ready', { count: ready.resolvedConcepts.length, forge: forgeName(repo) })
          : entry?.status === 'loading'
            ? t('expression.resolving')
            : t('expression.resolved_file_manual', { id: content.id })
      }
      action={
        ready ? (
          <Button size="xs" variant="outline" onClick={() => void copyAndOpen()}>
            {copied ? <ExternalLink size={12} /> : <Copy size={12} />}
            {t('expression.resolved_file_propose', { forge: forgeName(repo) })}
          </Button>
        ) : entry?.status === 'loading' ? (
          <Loader2 size={12} className="animate-spin" />
        ) : undefined
      }
    />
  )
}
