import { useTranslation } from 'react-i18next'
import { MessageSquareText } from 'lucide-react'
import { MarkdownRenderer } from '@/components/editor/markdown-renderer'
import { EmptyState } from '@/components/ui/empty-state'
import type { ConceptSet } from '@/lib/data'

interface CommentsTabProps {
  conceptSet: ConceptSet
  lang: string
}

/** The expert commentary: `longDescription` in the UI language, with no fallback to another. */
export function CommentsTab({ conceptSet, lang }: CommentsTabProps) {
  const { t } = useTranslation()
  const translations = conceptSet.metadata?.translations ?? {}
  const content = Object.hasOwn(translations, lang) ? translations[lang]?.longDescription : null

  if (!content?.trim()) {
    return (
      <EmptyState
        icon={MessageSquareText}
        title={t('concept_sets.comments.empty_title')}
        description={t('concept_sets.comments.empty_description')}
      />
    )
  }
  return <MarkdownRenderer content={content} className="max-w-4xl" />
}
