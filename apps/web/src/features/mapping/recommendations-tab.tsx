import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Loader2 } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { SectionLabel } from '@/components/ui/section-label'
import { MarkdownRenderer } from '@/components/editor/markdown-renderer'
import { cn } from '@/lib/utils'
import { findDraft } from '@/lib/drafts/overlay'
import { useCatalogStore } from '@/stores/catalog-store'
import { useDraftsStore } from '@/stores/drafts-store'
import { RecommendationsEditor, RecommendationsToolbar } from './recommendations-editing'
import { extractHeadings, headingSlug, visibleSections, type TocHeading } from './toc'

interface HastNode {
  type: string
  value?: string
  children?: HastNode[]
}

function hastText(node: HastNode | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.value ?? ''
  return (node.children ?? []).map(hastText).join('')
}

interface HeadingProps {
  node?: HastNode
  children?: ReactNode
}

// Heading ids from the heading's whole text, inline formatting included, so they
// match the table of contents built from the source.
const headingComponents = {
  h2: ({ node, children, ...props }: HeadingProps) => (
    <h2 {...props} id={headingSlug(hastText(node))} className="scroll-mt-4">
      {children}
    </h2>
  ),
  h3: ({ node, children, ...props }: HeadingProps) => (
    <h3 {...props} id={headingSlug(hastText(node))} className="scroll-mt-4">
      {children}
    </h3>
  ),
}

/** The nearest ancestor that scrolls (the page container), or null. */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let cur = el?.parentElement ?? null; cur; cur = cur.parentElement) {
    const { overflowY } = getComputedStyle(cur)
    if (overflowY === 'auto' || overflowY === 'scroll') return cur
  }
  return null
}

export function RecommendationsTab() {
  const { t, i18n } = useTranslation()
  const recommendations = useCatalogStore((s) => s.mappingRecommendations)
  const loadMappingRecommendations = useCatalogStore((s) => s.loadMappingRecommendations)
  const drafts = useDraftsStore((s) => s.drafts)
  const loadDrafts = useDraftsStore((s) => s.load)
  const [editing, setEditing] = useState(false)
  const draft = findDraft(drafts, 'mapping-recommendations', null)
  // This user's draft over the repository's recommendations.
  const shown = draft?.content ?? recommendations.data
  const content = shown?.translations?.[i18n.language]?.content ?? ''
  const headings = useMemo(() => extractHeadings(content), [content])

  useEffect(() => {
    loadMappingRecommendations()
    void loadDrafts()
  }, [loadMappingRecommendations, loadDrafts])

  if (recommendations.status === 'idle' || recommendations.status === 'loading') {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={24} className="animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (recommendations.status === 'error') {
    return <NoticeBanner tone="danger" title={t('mapping.load_error')} description={recommendations.error} />
  }
  if (editing) {
    return <RecommendationsEditor initial={shown ?? { translations: {} }} initialLang={i18n.language} onClose={() => setEditing(false)} />
  }
  return (
    <>
      <RecommendationsToolbar draft={draft} onEdit={() => setEditing(true)} />
      {content.trim() ? (
        <RecommendationsView content={content} headings={headings} />
      ) : (
        <EmptyState icon={FileText} title={t('mapping.no_recommendations')} className="mt-4" />
      )}
    </>
  )
}

interface RecommendationsViewProps {
  content: string
  headings: TocHeading[]
}

function RecommendationsView({ content, headings }: RecommendationsViewProps) {
  const { t } = useTranslation()
  const contentRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<ReadonlySet<number>>(new Set())

  // Scroll spy, as v1: highlight every section (heading to next heading) in view.
  useEffect(() => {
    const container = contentRef.current
    const scroller = scrollParent(container)
    if (!container || !scroller || headings.length === 0) return
    let frame = 0
    const update = () => {
      frame = 0
      const view = scroller.getBoundingClientRect()
      const tops = headings.map((h) => document.getElementById(h.id)?.getBoundingClientRect().top ?? Infinity)
      const bottom = container.getBoundingClientRect().bottom
      setActive(new Set(visibleSections(tops, bottom, view.top, view.bottom)))
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    schedule()
    scroller.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      scroller.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [headings, content])

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_14rem]">
      <div ref={contentRef} className="min-w-0">
        <MarkdownRenderer content={content} extraComponents={headingComponents} />
      </div>
      {headings.length > 0 && (
        <nav aria-label={t('mapping.on_this_page')} className="hidden lg:block">
          <div className="sticky top-4">
            <SectionLabel as="h2" className="mb-2">
              {t('mapping.on_this_page')}
            </SectionLabel>
            <ul className="flex flex-col gap-0.5 border-l text-xs">
              {headings.map((h, i) => (
                <li key={i}>
                  <a
                    href={`#${h.id}`}
                    onClick={(e) => {
                      e.preventDefault()
                      document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }}
                    className={cn(
                      '-ml-px block border-l-2 py-1 pr-2 transition-colors hover:text-foreground',
                      h.level === 3 ? 'pl-6' : 'pl-3',
                      active.has(i)
                        ? 'border-primary font-medium text-foreground'
                        : 'border-transparent text-muted-foreground',
                    )}
                  >
                    {h.text}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </nav>
      )}
    </div>
  )
}
