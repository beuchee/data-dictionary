// Adapted from linkr@1310cf4a4 apps/web/src/components/editor/MarkdownRenderer.tsx
// Dropped: KaTeX (remark-math / rehype-katex, a heavy dependency no description
// uses), mermaid (a remote CDN import) and wikilinks. Kept: GFM, raw HTML through
// the sanitizer, callouts, [[toc]], heading anchors, external links in a new tab.
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { ExternalLink } from 'lucide-react'
import { markdownComponents, processCallouts } from '@/components/editor/markdown-components'
import { cn } from '@/lib/utils'


const remarkPlugins = [remarkGfm]

const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    img: [...(defaultSchema.attributes?.img ?? []), 'alt', 'width', 'height'],
    span: [...(defaultSchema.attributes?.span ?? []), 'className', 'style'],
    // hast property names, not HTML attribute names: rehype-raw has already
    // turned `data-callout` into `dataCallout` by the time the sanitizer runs.
    div: [...(defaultSchema.attributes?.div ?? []), 'className', 'style', 'dataCallout'],
    details: [],
    summary: [],
    code: [...(defaultSchema.attributes?.code ?? []), 'className'],
  },
  tagNames: [...(defaultSchema.tagNames ?? []), 'details', 'summary'],
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rehypePlugins: any[] = [rehypeRaw, [rehypeSanitize, sanitizeSchema]]

const safeProtocol = /^(https?|ircs?|mailto|xmpp|blob)$/i
function urlTransform(value: string): string {
  const colon = value.indexOf(':')
  const questionMark = value.indexOf('?')
  const numberSign = value.indexOf('#')
  const slash = value.indexOf('/')
  if (
    colon === -1 ||
    (slash !== -1 && colon > slash) ||
    (questionMark !== -1 && colon > questionMark) ||
    (numberSign !== -1 && colon > numberSign) ||
    safeProtocol.test(value.slice(0, colon))
  ) {
    return value
  }
  return ''
}

function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function processToc(markdown: string): string {
  if (!markdown.includes('[[toc]]')) return markdown
  const headings: { level: number; text: string; id: string }[] = []
  for (const line of markdown.split('\n')) {
    const match = line.match(/^(#{1,3})\s+(.+)$/)
    if (match) headings.push({ level: match[1].length, text: match[2].trim(), id: slugify(match[2].trim()) })
  }
  if (headings.length === 0) return markdown.replace('[[toc]]', '')
  const toc = headings.map((h) => `${'  '.repeat(h.level - 1)}- [${h.text}](#${h.id})`).join('\n')
  return markdown.replace('[[toc]]', toc)
}

function getHeadingId(children: React.ReactNode): string {
  const text =
    typeof children === 'string'
      ? children
      : Array.isArray(children)
        ? children.map((c) => (typeof c === 'string' ? c : '')).join('')
        : ''
  return slugify(text)
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const rendererComponents = {
  // An off-site link opens in a new tab and says so; in-page anchors keep navigating in place.
  a: ({ node: _node, href, children, ...props }: any) => {
    const isExternal = typeof href === 'string' && /^(https?|mailto):/i.test(href)
    if (!isExternal) return <a href={href} {...props}>{children}</a>
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-baseline gap-1" {...props}>
        {children}
        <ExternalLink size={11} className="ml-px shrink-0 translate-y-px opacity-70" aria-hidden />
      </a>
    )
  },
  h1: ({ node: _node, children, ...props }: any) => <h1 id={getHeadingId(children)} {...props}>{children}</h1>,
  h2: ({ node: _node, children, ...props }: any) => <h2 id={getHeadingId(children)} {...props}>{children}</h2>,
  h3: ({ node: _node, children, ...props }: any) => <h3 id={getHeadingId(children)} {...props}>{children}</h3>,
}
/* eslint-enable @typescript-eslint/no-explicit-any */

interface MarkdownRendererProps {
  content: string
  className?: string
  /** Extra ReactMarkdown overrides, applied last (e.g. heading observers for a table of contents). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extraComponents?: Record<string, any>
}

/** Sanitized GitHub-flavoured Markdown in a `.prose` block. */
export function MarkdownRenderer({ content, className, extraComponents }: MarkdownRendererProps) {
  const processed = processToc(processCallouts(content))
  // `prose-a:` rather than a class on the anchor: Tailwind Typography styles
  // links as `.prose a`, which outranks a plain utility class.
  return (
    <div className={cn('prose prose-sm dark:prose-invert max-w-none prose-a:transition-colors hover:prose-a:text-muted-foreground', className)}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        urlTransform={urlTransform}
        components={{ ...markdownComponents, ...rendererComponents, ...extraComponents }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  )
}
