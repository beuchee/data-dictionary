import {
  BookMarked,
  BookOpen,
  Braces,
  ClipboardCheck,
  Download,
  FileText,
  FolderKanban,
  GitFork,
  HardDrive,
  Library,
  Lightbulb,
  Pencil,
  Rocket,
  Search,
  Settings,
  Share2,
  SquareTerminal,
  Waypoints,
  type LucideIcon,
} from 'lucide-react'

/** The icons `content/docs/index.json` may name; an index entry outside this map fails the docs test. */
export const DOC_ICONS: Readonly<Record<string, LucideIcon>> = {
  BookMarked,
  BookOpen,
  Braces,
  ClipboardCheck,
  Download,
  FileText,
  FolderKanban,
  GitFork,
  HardDrive,
  Library,
  Lightbulb,
  Pencil,
  Rocket,
  Search,
  Settings,
  Share2,
  SquareTerminal,
  Waypoints,
}

export function docIcon(name: string): LucideIcon {
  return DOC_ICONS[name] ?? FileText
}
