import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquarePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { isServerMode } from '@/lib/api-client'
import { isNewDraft } from '@/lib/drafts/paths'
import { canEdit } from '@/lib/drafts/permissions'
import { userHasPermission, useAuthStore } from '@/stores/auth-store'
import { useDraftsStore } from '@/stores/drafts-store'
import { SubmitDialog } from '@/features/drafts/submit-dialog'
import { appendReview, type ReviewInput } from '../lib/editing'
import { ReviewDialog } from './review-dialog'
import type { ConceptSet } from '@data-dictionary/format'
import type { DraftOf } from '@/lib/drafts/types'

interface AddReviewProps {
  /** The set as shown (its version is the one reviewed). */
  conceptSet: ConceptSet
  /** The repository's version, to submit a reviews-only change against. */
  base: ConceptSet | null
  draft: DraftOf<'concept-set'> | undefined
}

/**
 * "Add review" on the Reviews tab. The review is appended to the set's file as
 * a draft, then submitted right away: in server mode a reviewer (`reviews:write`)
 * may propose a draft whose only change is new reviews, so the draft is the
 * repository's version plus the review, not stamped; static mode hands it to
 * the forge like any change.
 */
export function AddReview({ conceptSet, base, draft }: AddReviewProps) {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.user)
  const saveDraft = useDraftsStore((s) => s.save)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState<DraftOf<'concept-set'> | null>(null)
  const has = (p: string) => userHasPermission(user, p)
  if (!has('reviews:write') && !canEdit('concept-set', has)) return null

  const submit = async (review: Omit<ReviewInput, 'timestamp'>) => {
    setBusy(true)
    setError(null)
    try {
      // On top of the user's pending draft when there is one, else of the repository's version.
      const from = draft?.content ?? base ?? conceptSet
      const content = appendReview(from, { ...review, timestamp: new Date().toISOString() })
      const saved = await saveDraft({ kind: 'concept-set', targetId: draft && isNewDraft(draft) ? null : conceptSet.id, content })
      setOpen(false)
      setSubmitting(saved)
    } catch (e) {
      console.error('Could not save the review', e)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-3 flex flex-col items-end gap-2">
      <Button variant="outline" onClick={() => setOpen(true)}>
        <MessageSquarePlus size={14} />
        {t('concept_sets.review.add')}
      </Button>
      {error && <NoticeBanner tone="danger" title={t('drafts.save_failed')} description={error} className="w-full" />}
      <ReviewDialog open={open} onOpenChange={setOpen} version={conceptSet.version} onSubmit={submit} busy={busy} />
      <SubmitDialog
        open={submitting !== null}
        onOpenChange={(o) => !o && setSubmitting(null)}
        draft={submitting}
        base={base}
        intro={isServerMode() ? undefined : t('drafts.propose.review_intro')}
      />
    </div>
  )
}
