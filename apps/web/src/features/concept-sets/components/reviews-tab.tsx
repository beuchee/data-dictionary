import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ClipboardCheck, ExternalLink } from 'lucide-react'
import { MarkdownRenderer } from '@/components/editor/markdown-renderer'
import { Badge } from '@/components/ui/badge'
import { DataTable, type DataTableColumn } from '@/components/ui/data-table'
import { DialogShell } from '@/components/ui/dialog-shell'
import { EmptyState } from '@/components/ui/empty-state'
import { StatusBadge } from './badges'
import type { Review } from '@data-dictionary/format'
import type { ConceptSet } from '@/lib/data'

interface ReviewRow {
  index: number
  reviewer: string
  affiliation: string
  orcid: string
  date: string
  version: string
  status: string
  comments: string
  review: Review
}

function reviewerName(review: Review): string {
  const r = review.reviewer ?? {}
  return [r.firstName, r.lastName].filter(Boolean).join(' ')
}

/** One line of plain text from a Markdown comment, for the table. */
function preview(markdown: string): string {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function toRows(reviews: Review[]): ReviewRow[] {
  return reviews.map((review, index) => ({
    index,
    reviewer: reviewerName(review),
    affiliation: review.reviewer?.affiliation ?? '',
    orcid: review.reviewer?.orcid ?? '',
    date: (review.reviewTimestamp ?? '').slice(0, 10),
    version: review.version ?? '',
    status: review.status ?? '',
    comments: review.comments ?? '',
    review,
  }))
}

export function ReviewsTab({ conceptSet }: { conceptSet: ConceptSet }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState<ReviewRow | null>(null)
  const rows = toRows(Array.isArray(conceptSet.metadata?.reviews) ? conceptSet.metadata.reviews : [])

  const statusLabel = (s: string) => (s ? t(`concept_sets.status.${s}`, { defaultValue: s }) : t('concept_sets.reviews.comment_only'))
  const columns: DataTableColumn<ReviewRow>[] = [
    { id: 'reviewer', header: t('concept_sets.reviews.reviewer'), accessor: (r) => r.reviewer, filter: 'select', size: 170 },
    { id: 'affiliation', header: t('concept_sets.reviews.affiliation'), accessor: (r) => r.affiliation, size: 200, hidden: true },
    { id: 'date', header: t('concept_sets.reviews.date'), accessor: (r) => r.date, size: 100 },
    { id: 'version', header: t('concept_sets.columns.version'), accessor: (r) => r.version, filter: 'select', size: 80, align: 'center' },
    {
      id: 'status',
      header: t('concept_sets.columns.status'),
      accessor: (r) => r.status,
      display: (r) => statusLabel(r.status),
      filter: 'select',
      size: 130,
      align: 'center',
      cell: (r) => (r.status ? <StatusBadge status={r.status} /> : <Badge variant="secondary">{statusLabel('')}</Badge>),
    },
    { id: 'comments', header: t('concept_sets.reviews.comments'), accessor: (r) => preview(r.comments), size: 420 },
  ]

  if (!rows.length) {
    return (
      <EmptyState
        icon={ClipboardCheck}
        title={t('concept_sets.reviews.empty_title')}
        description={t('concept_sets.reviews.empty_description')}
      />
    )
  }

  return (
    <>
      <DataTable
        data={rows}
        columns={columns}
        rowKey={(r) => r.index}
        onRowClick={setOpen}
        initialSorting={{ columnId: 'date', desc: true }}
        viewKey="concept-set-reviews"
      />
      <DialogShell
        open={open !== null}
        onOpenChange={(o) => !o && setOpen(null)}
        kind="settings"
        title={t('concept_sets.reviews.dialog_title', { reviewer: open?.reviewer || '—' })}
        description={
          open ? (
            <span className="flex flex-wrap items-center gap-1.5">
              {open.date && <span>{open.date}</span>}
              {open.version && <Badge variant="outline">v{open.version}</Badge>}
              {open.status ? <StatusBadge status={open.status} /> : null}
            </span>
          ) : null
        }
      >
        {open && (
          <div className="space-y-3">
            {(open.affiliation || open.orcid) && (
              <p className="text-xs text-muted-foreground">
                {open.affiliation}
                {open.orcid && (
                  <a
                    href={`https://orcid.org/${encodeURIComponent(open.orcid)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    ORCID {open.orcid}
                    <ExternalLink size={11} aria-hidden />
                  </a>
                )}
              </p>
            )}
            {open.comments.trim() ? (
              <MarkdownRenderer content={open.comments} />
            ) : (
              <p className="text-xs text-muted-foreground">{t('concept_sets.reviews.no_comment')}</p>
            )}
          </div>
        )}
      </DialogShell>
    </>
  )
}
