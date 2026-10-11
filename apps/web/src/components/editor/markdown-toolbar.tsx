// Adapted from linkr@1310cf4a4 apps/web/src/components/editor/MarkdownToolbar.tsx
// (the basic groups only, labels translated; the help dialog left out).
import { useTranslation } from 'react-i18next'
import {
  Bold,
  CheckSquare,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Image,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  Quote,
  SquareCode,
  Strikethrough,
  Table,
  type LucideIcon,
} from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { MarkdownFormat } from './markdown-format'

const GROUPS: { format: MarkdownFormat; icon: LucideIcon }[][] = [
  [
    { format: 'h1', icon: Heading1 },
    { format: 'h2', icon: Heading2 },
    { format: 'h3', icon: Heading3 },
  ],
  [
    { format: 'bold', icon: Bold },
    { format: 'italic', icon: Italic },
    { format: 'strikethrough', icon: Strikethrough },
  ],
  [
    { format: 'ul', icon: List },
    { format: 'ol', icon: ListOrdered },
    { format: 'checklist', icon: CheckSquare },
  ],
  [
    { format: 'code', icon: Code },
    { format: 'codeblock', icon: SquareCode },
    { format: 'quote', icon: Quote },
    { format: 'link', icon: LinkIcon },
    { format: 'image', icon: Image },
  ],
  [
    { format: 'hr', icon: Minus },
    { format: 'table', icon: Table },
  ],
]

interface MarkdownToolbarProps {
  onFormat: (format: MarkdownFormat) => void
  /** Right-aligned extras (a language switch, a preview toggle). */
  children?: React.ReactNode
}

export function MarkdownToolbar({ onFormat, children }: MarkdownToolbarProps) {
  const { t } = useTranslation()
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-b px-2 py-1">
      {GROUPS.map((group, gi) => (
        <div key={gi} className="flex items-center">
          {gi > 0 && <Separator orientation="vertical" className="mx-1 !h-4" />}
          {group.map(({ format, icon: Icon }) => (
            <Tooltip key={format}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onFormat(format)}
                  aria-label={t(`editor.format.${format}`)}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Icon size={14} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t(`editor.format.${format}`)}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      ))}
      {children && <div className="ml-auto flex items-center gap-1">{children}</div>}
    </div>
  )
}
