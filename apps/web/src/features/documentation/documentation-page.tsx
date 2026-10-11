import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import { MarkdownRenderer, processCallouts } from '@/components/editor/MarkdownRenderer'
import { NoticeBanner } from '@/components/ui/notice-banner'
import { PageHeader } from '@/components/ui/page-header'
import { SectionLabel } from '@/components/ui/section-label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useInstanceConfig } from '@/stores/config-store'
import { hasDoc, loadDoc } from './doc-content'
import { docIcon } from './doc-icons'
import { DOC_GROUPS, flattenSections, localized, neighbours, resolveSection, sectionFromHref, type DocSection } from './doc-index'
import { extractHeadings, hastText, headingId, splitTitle, type DocHeading } from './doc-markdown'
import { docVariables, substitutePlaceholders, type DocVariables } from './doc-placeholders'

const SECTIONS = flattenSections()
const DOC_PATH = '/documentation'
/** How far below the scroll container's top a heading still counts as the one being read. */
const TOC_OFFSET = 96

type LoadedDoc = { key: string; status: 'ready'; markdown: string } | { key: string; status: 'error' }

/** The Markdown of a section in a language, loaded lazily; `missing` when that translation does not exist. */
function useDocMarkdown(lang: string, section: string) {
  const key = `${lang}/${section}`
  const [loaded, setLoaded] = useState<LoadedDoc | null>(null)

  useEffect(() => {
    const pending = loadDoc(lang, section)
    if (!pending) return
    let cancelled = false
    pending.then(
      (markdown) => {
        if (!cancelled) setLoaded({ key, status: 'ready', markdown })
      },
      (error: unknown) => {
        console.error(`Documentation section ${key} failed to load`, error)
        if (!cancelled) setLoaded({ key, status: 'error' })
      },
    )
    return () => {
      cancelled = true
    }
  }, [key, lang, section])

  if (!hasDoc(lang, section)) return { status: 'missing' as const }
  if (!loaded || loaded.key !== key) return { status: 'loading' as const }
  return loaded
}

/** A label from the index, with the instance values filled in; the id when this language has none. */
function sectionLabel(section: DocSection, lang: string, variables: DocVariables): string {
  const label = localized(section.title, lang)
  return label ? substitutePlaceholders(label, variables) : section.id
}

export function DocumentationPage() {
  const { t, i18n } = useTranslation()
  const config = useInstanceConfig()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [activeHeading, setActiveHeading] = useState<string | null>(null)

  const lang = i18n.language
  const { id: sectionId, known } = resolveSection(params.get('section'), SECTIONS)
  const section = SECTIONS.find((s) => s.id === sectionId)
  const variables = useMemo(() => docVariables(config), [config])
  const doc = useDocMarkdown(lang, sectionId)
  const { prev, next } = neighbours(sectionId, SECTIONS)

  const page = useMemo(() => {
    if (doc.status !== 'ready') return null
    const { title, body } = splitTitle(substitutePlaceholders(doc.markdown, variables))
    // Headings are read from the exact text the renderer parses (callouts already
    // expanded; doing it again there is a no-op), so their lines match `node.position`.
    const markdown = processCallouts(body)
    const headings = extractHeadings(markdown)
    return { title, markdown, headings, components: docComponents(headings) }
  }, [doc, variables])

  // An unknown `?section=` (a renamed section, a typo) lands on the first one with a clean URL.
  useEffect(() => {
    if (!known) navigate({ pathname: DOC_PATH, search: `?section=${sectionId}` }, { replace: true })
  }, [known, sectionId, navigate])

  // A new section starts at its top, or at the heading the URL's hash names.
  useEffect(() => {
    if (!page) return
    const frame = requestAnimationFrame(() => {
      const container = scrollRef.current
      if (!container) return
      const target = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null
      if (target) target.scrollIntoView({ block: 'start' })
      else container.scrollTo({ top: 0 })
      setActiveHeading(currentHeading(container, page.headings))
    })
    return () => cancelAnimationFrame(frame)
  }, [page, location.hash])

  const groupOf = DOC_GROUPS.find((g) => g.sections.some((s) => s.id === sectionId))
  const fallbackTitle = section ? sectionLabel(section, lang, variables) : sectionId

  return (
    <div className="flex h-full">
      <nav aria-label={t('documentation.sections')} className="hidden w-60 shrink-0 overflow-y-auto border-r px-3 py-6 md:block">
        {DOC_GROUPS.map((group) => (
          <div key={group.id} className="mb-5">
            <SectionLabel as="h2" className="mb-1.5 px-2">
              {localized(group.title, lang) ?? group.id}
            </SectionLabel>
            <ul className="space-y-0.5">
              {group.sections.map((s) => {
                const Icon = docIcon(s.icon)
                const active = s.id === sectionId
                return (
                  <li key={s.id}>
                    <Link
                      to={{ pathname: DOC_PATH, search: `?section=${s.id}` }}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                        active ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                      )}
                    >
                      <Icon size={14} className="shrink-0" />
                      <span className="truncate">{sectionLabel(s, lang, variables)}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div
        ref={scrollRef}
        className="min-w-0 flex-1 overflow-y-auto"
        onScroll={(e) => page && setActiveHeading(currentHeading(e.currentTarget, page.headings))}
      >
        <div className="mx-auto max-w-3xl px-6 py-10">
          <div className="mb-6 md:hidden">
            <Select value={sectionId} onValueChange={(id) => navigate({ pathname: DOC_PATH, search: `?section=${id}` })}>
              <SelectTrigger aria-label={t('documentation.sections')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOC_GROUPS.map((group) => (
                  <SelectGroup key={group.id}>
                    <SelectLabel>{localized(group.title, lang) ?? group.id}</SelectLabel>
                    {group.sections.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {sectionLabel(s, lang, variables)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>

          <PageHeader
            title={page?.title ?? fallbackTitle}
            above={groupOf ? <SectionLabel>{localized(groupOf.title, lang) ?? groupOf.id}</SectionLabel> : undefined}
          />

          <div className="mt-6">
            {doc.status === 'missing' && (
              <NoticeBanner
                tone="warning"
                title={t('documentation.missing_translation', { language: lang.toUpperCase() })}
                description={t('documentation.missing_translation_hint')}
              />
            )}
            {doc.status === 'error' && (
              <NoticeBanner
                tone="danger"
                title={t('documentation.load_error')}
                description={t('documentation.load_error_hint')}
              />
            )}
            {doc.status === 'loading' && <DocSkeleton />}
            {page && <MarkdownRenderer content={page.markdown} extraComponents={page.components} />}
          </div>

          <nav aria-label={t('documentation.pagination')} className="mt-12 grid grid-cols-2 gap-3 border-t pt-6">
            <div>{prev && <PagerLink section={prev} direction="prev" label={sectionLabel(prev, lang, variables)} />}</div>
            <div>{next && <PagerLink section={next} direction="next" label={sectionLabel(next, lang, variables)} />}</div>
          </nav>
        </div>
      </div>

      <aside className="hidden w-56 shrink-0 overflow-y-auto py-10 pr-4 xl:block">
        {page && page.headings.length > 0 && (
          <TableOfContents
            headings={page.headings}
            activeId={activeHeading}
            onSelect={(id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          />
        )}
      </aside>
    </div>
  )
}

/** The heading being read: the last one whose top has scrolled past the container's top band. */
function currentHeading(container: HTMLElement, headings: DocHeading[]): string | null {
  const top = container.getBoundingClientRect().top + TOC_OFFSET
  let current: string | null = headings[0]?.id ?? null
  for (const h of headings) {
    const el = document.getElementById(h.id)
    if (el && el.getBoundingClientRect().top <= top) current = h.id
  }
  return current
}

interface TableOfContentsProps {
  headings: DocHeading[]
  activeId: string | null
  onSelect: (id: string) => void
}

function TableOfContents({ headings, activeId, onSelect }: TableOfContentsProps) {
  const { t } = useTranslation()
  const minLevel = Math.min(...headings.map((h) => h.level))
  return (
    <nav aria-label={t('documentation.on_this_page')}>
      <SectionLabel as="h2" className="mb-2">
        {t('documentation.on_this_page')}
      </SectionLabel>
      <ul className="space-y-1 border-l">
        {headings.map((h) => (
          <li key={h.id}>
            <button
              type="button"
              onClick={() => onSelect(h.id)}
              style={{ paddingLeft: `${0.75 + (h.level - minLevel) * 0.75}rem` }}
              className={cn(
                '-ml-px block w-full border-l py-0.5 pr-1 text-left text-xs transition-colors',
                h.id === activeId
                  ? 'border-primary font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {h.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

interface PagerLinkProps {
  section: DocSection
  direction: 'prev' | 'next'
  label: string
}

function PagerLink({ section, direction, label }: PagerLinkProps) {
  const { t } = useTranslation()
  return (
    <Link
      to={{ pathname: DOC_PATH, search: `?section=${section.id}` }}
      className={cn(
        'flex flex-col gap-0.5 rounded-lg border px-4 py-3 transition-colors hover:bg-accent',
        direction === 'next' && 'items-end text-right',
      )}
    >
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        {direction === 'prev' && <ChevronLeft size={12} />}
        {t(direction === 'prev' ? 'documentation.previous' : 'documentation.next')}
        {direction === 'next' && <ChevronRight size={12} />}
      </span>
      <span className="text-sm font-medium">{label}</span>
    </Link>
  )
}

function DocSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="mt-8 h-6 w-1/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  )
}

// --- Markdown overrides ---

interface MarkdownNodeProps {
  node?: Parameters<typeof hastText>[0] & { position?: { start?: { line?: number } } }
  children?: ReactNode
}

/**
 * h2–h4 carrying the ids the table of contents links to, found by source line
 * (a repeated heading gets a suffixed id); the text slug if the line is unknown.
 */
function docComponents(headings: DocHeading[]) {
  const idByLine = new Map(headings.map((h) => [h.line, h.id]))
  const heading = (Tag: 'h2' | 'h3' | 'h4') =>
    function DocHeadingTag({ node, children, ...props }: MarkdownNodeProps) {
      const line = node?.position?.start?.line
      const id = (line !== undefined && idByLine.get(line)) || headingId(hastText(node))
      return (
        <Tag {...props} id={id} className="scroll-mt-6">
          {children}
        </Tag>
      )
    }
  return { h2: heading('h2'), h3: heading('h3'), h4: heading('h4'), a: DocLink }
}

/**
 * Links between sections (`?section=…`) navigate inside the app; an off-site
 * link opens in a new tab and says so, as in Linkr's renderer.
 */
function DocLink({ node: _node, href, children, ...props }: MarkdownNodeProps & { href?: string }) {
  const target = sectionFromHref(href)
  if (target) return <Link to={{ pathname: DOC_PATH, search: `?section=${target}` }}>{children}</Link>
  if (href && /^(https?|mailto):/i.test(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-baseline gap-1" {...props}>
        {children}
        <ExternalLink size={11} className="ml-px shrink-0 translate-y-px opacity-70" aria-hidden />
      </a>
    )
  }
  return (
    <a href={href} {...props}>
      {children}
    </a>
  )
}
