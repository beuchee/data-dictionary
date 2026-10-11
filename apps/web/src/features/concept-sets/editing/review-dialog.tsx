import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DialogShell } from '@/components/ui/dialog-shell'
import { FieldError } from '@/components/ui/field-error'
import { FormField } from '@/components/ui/form-field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MarkdownEditor } from '@/components/editor/markdown-editor'
import { useEditorIdentity } from '@/features/drafts/identity'
import { LocalProfileFields } from '@/features/drafts/local-profile-fields'
import { REVIEW_STATUSES, type ReviewStatus } from '@data-dictionary/format'
import type { PendingEdits } from '@/components/editor/code-editor'
import type { ReviewInput } from '../lib/editing'

interface ReviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The version reviewed, shown for context. */
  version: string
  onSubmit: (review: Omit<ReviewInput, 'timestamp'>) => void | Promise<void>
  busy?: boolean
}

const COMMENT = 'comment'

/**
 * Adds a review to the set: a verdict (one of the review statuses) or, by
 * default, a plain comment with no status, in Markdown; the reviewer is the
 * signed-in profile (server) or the local one (static).
 */
export function ReviewDialog({ open, onOpenChange, version, onSubmit, busy }: ReviewDialogProps) {
  const { t } = useTranslation()
  const { person, name } = useEditorIdentity()
  const [status, setStatus] = useState<string>(COMMENT)
  const [comments, setComments] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const pending = useRef<PendingEdits | null>(null)
  // The editor's text as of its last flush, readable right after `flush()` (state is not yet).
  const latest = useRef('')
  const change = (text: string) => {
    latest.current = text
    setComments(text)
  }

  // Reset when the dialog opens. A plain comment by default: passing a verdict should be a deliberate choice (v1).
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setStatus(COMMENT)
      setComments('')
      setSubmitted(false)
    }
  }
  useEffect(() => {
    if (open) latest.current = ''
  }, [open])

  const confirm = () => {
    pending.current?.flush()
    setSubmitted(true)
    const text = latest.current
    if (!text.trim() || !name) return
    void onSubmit({ status: status === COMMENT ? null : (status as ReviewStatus), comments: text, reviewer: person })
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      kind="workbench"
      title={t('concept_sets.review.title')}
      description={t('concept_sets.review.description', { version })}
      onConfirm={confirm}
      confirmLabel={t('concept_sets.review.submit')}
      busy={busy}
      noEnterSubmit
    >
      <div className="flex h-full flex-col gap-3">
        <FormField label={t('concept_sets.review.status')} className="max-w-xs">
          {({ id }) => (
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger id={id} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={COMMENT}>{t('concept_sets.reviews.comment_only')}</SelectItem>
                {REVIEW_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`concept_sets.status.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
        <MarkdownEditor value={comments} onChange={change} height="45vh" pendingEditsRef={pending} />
        <FieldError message={submitted && !comments.trim() ? t('concept_sets.review.comments_required') : null} />
        {name ? (
          <p className="text-xs text-muted-foreground">{t('concept_sets.review.as', { name })}</p>
        ) : (
          <>
            <FieldError message={submitted ? t('concept_sets.review.name_required') : null} />
            <LocalProfileFields />
          </>
        )}
      </div>
    </DialogShell>
  )
}
