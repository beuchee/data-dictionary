import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { appName, brandingImageUrl } from '@/lib/config'
import { useInstanceConfig } from '@/stores/config-store'
import { BOTTOM_NAV_ITEMS, activeNavItem, mainNavItems, type NavItem } from './nav-items'

export function AppSidebar() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const config = useInstanceConfig()
  const items = mainNavItems(config)
  const active = activeNavItem(pathname, [...items, ...BOTTOM_NAV_ITEMS])
  const logo = brandingImageUrl(config, 'logo')
  const name = appName(config)

  const renderItem = (item: NavItem) => {
    const isActive = active?.path === item.path
    return (
      <SidebarMenuItem key={item.path}>
        <SidebarMenuButton asChild isActive={isActive} tooltip={t(item.labelKey)}>
          <Link to={item.path}>
            <item.icon />
            <span>{t(item.labelKey)}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    )
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="flex-row items-center justify-between p-3">
        <Link
          to="/"
          className="flex min-w-0 items-center gap-2.5 transition-opacity hover:opacity-80 group-data-[collapsible=icon]:hidden"
        >
          {logo && (
            <img src={logo} alt={config.branding?.logoAlt ?? name} className="h-7 w-auto shrink-0 object-contain" />
          )}
          <span className="truncate text-sm font-semibold text-sidebar-foreground">{name}</span>
        </Link>
        <SidebarTrigger aria-label={t('layout.header.toggle_sidebar')} />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t('nav.menu')}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{items.map(renderItem)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        {/* Edge to edge: pulled out of the footer's 0.5rem padding and widened by both sides. */}
        <SidebarSeparator className="-mx-2 data-[orientation=horizontal]:w-[calc(100%+1rem)]" />
        <SidebarMenu>{BOTTOM_NAV_ITEMS.map(renderItem)}</SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
