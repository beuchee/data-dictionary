import { BookOpen, FolderKanban, Library, Settings, SquareTerminal, Waypoints, type LucideIcon } from 'lucide-react'
import type { InstanceConfig } from '@/lib/config'

export interface NavItem {
  path: string
  labelKey: string
  icon: LucideIcon
}

const MAIN_ITEMS: (NavItem & { visible?: (config: InstanceConfig) => boolean })[] = [
  { path: '/concept-sets', labelKey: 'nav.concept_sets', icon: Library },
  {
    path: '/projects',
    labelKey: 'nav.projects',
    icon: FolderKanban,
    visible: (c) => c.tabs?.showProjects !== false,
  },
  {
    path: '/mapping',
    labelKey: 'nav.mapping',
    icon: Waypoints,
    visible: (c) => c.tabs?.showMappingRecommendations !== false,
  },
]

export const BOTTOM_NAV_ITEMS: NavItem[] = [
  { path: '/settings', labelKey: 'nav.settings', icon: Settings },
  { path: '/dev-tools', labelKey: 'nav.dev_tools', icon: SquareTerminal },
  { path: '/documentation', labelKey: 'nav.documentation', icon: BookOpen },
]

export function mainNavItems(config: InstanceConfig): NavItem[] {
  return MAIN_ITEMS.filter((item) => !item.visible || item.visible(config))
}

/** The nav item a pathname belongs to (`/settings/units` → Settings). */
export function activeNavItem(pathname: string, items: NavItem[]): NavItem | undefined {
  return items.find((item) => pathname === item.path || pathname.startsWith(`${item.path}/`))
}
