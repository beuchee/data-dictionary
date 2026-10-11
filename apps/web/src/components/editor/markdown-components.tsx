// Adapted from linkr@1310cf4a4 apps/web/src/components/editor/markdown-components.tsx
// Images render as a plain capped <img> (Linkr's lightbox is not copied).
import { AlertCircle, AlertTriangle, Info, Lightbulb } from 'lucide-react'
import { SectionLabel } from '@/components/ui/section-label'

/**
 * A screenshot is legible well before it is page-wide. `!max-w-` because
 * Tailwind Typography styles images as `.prose img`, which outranks a plain
 * utility class.
 */
const IMG_CLASS = '!mx-auto !max-w-full sm:!max-w-[620px] h-auto rounded-md border'

// --- Callouts (GitHub alert syntax) ---

/**
 * `> [!WARNING]` and friends. remark-gfm passes them through as a plain
 * blockquote, so `processCallouts` rewrites the blockquote into a marked `<div>`
 * before parsing, and the `div` override below renders that marker. Both halves
 * must travel together.
 */
const CALLOUT_REGEX = /^> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n((?:> .*(?:\n|$))*)/gm

export function processCallouts(markdown: string): string {
  return markdown.replace(CALLOUT_REGEX, (_match, type: string, body: string) => {
    const content = body.replace(/^> ?/gm, '').trim()
    return `<div data-callout="${type.toLowerCase()}">\n\n${content}\n\n</div>\n`
  })
}

type CalloutStyle = { icon: React.ReactNode; border: string; bg: string; accent: string }

const calloutStyles: Record<string, CalloutStyle> = {
  note: { icon: <Info size={15} />, border: 'border-blue-500/40', bg: 'bg-blue-500/5', accent: 'text-blue-600 dark:text-blue-400' },
  tip: { icon: <Lightbulb size={15} />, border: 'border-emerald-500/40', bg: 'bg-emerald-500/5', accent: 'text-emerald-600 dark:text-emerald-400' },
  important: { icon: <AlertCircle size={15} />, border: 'border-violet-500/40', bg: 'bg-violet-500/5', accent: 'text-violet-600 dark:text-violet-400' },
  warning: { icon: <AlertTriangle size={15} />, border: 'border-amber-500/40', bg: 'bg-amber-500/5', accent: 'text-amber-600 dark:text-amber-400' },
  caution: { icon: <AlertTriangle size={15} />, border: 'border-red-500/40', bg: 'bg-red-500/5', accent: 'text-red-600 dark:text-red-400' },
}

/** The keyword the author typed in the source, untranslated, as GitHub renders it. */
const calloutLabels: Record<string, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const markdownComponents: Record<string, any> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  img: ({ node: _node, className, alt, ...props }: any) => (
    <img {...props} alt={alt ?? ''} className={className ? `${IMG_CLASS} ${className}` : IMG_CLASS} />
  ),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  div: ({ node: _node, children, ...props }: any) => {
    const type = props['data-callout']
    const style = Object.hasOwn(calloutStyles, type) ? calloutStyles[type] : undefined
    if (!style) return <div {...props}>{children}</div>
    return (
      <div className={`my-3 rounded-lg border-l-4 ${style.border} ${style.bg} px-4 py-3`}>
        <SectionLabel className={`mb-1.5 flex items-center gap-1.5 text-xs font-semibold ${style.accent}`}>
          {style.icon}
          {calloutLabels[type]}
        </SectionLabel>
        <div className="[&>p:first-child]:mt-0 [&>p:last-child]:mb-0 [&>p]:my-2">{children}</div>
      </div>
    )
  },
}
