import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'
import { Check, Languages, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DraftsIndicator } from '@/features/drafts/drafts-indicator'
import { UI_LANGUAGES } from '@/lib/i18n'
import { useAppStore } from '@/stores/app-store'
import { useInstanceConfig } from '@/stores/config-store'
import { BOTTOM_NAV_ITEMS, activeNavItem, mainNavItems } from './nav-items'
import { UserMenu } from './user-menu'

export function Header() {
  const { t, i18n } = useTranslation()
  const { pathname } = useLocation()
  const config = useInstanceConfig()
  const darkMode = useAppStore((s) => s.darkMode)
  const toggleDarkMode = useAppStore((s) => s.toggleDarkMode)
  const setLanguage = useAppStore((s) => s.setLanguage)
  const { isMobile } = useSidebar()

  const active = activeNavItem(pathname, [...mainNavItems(config), ...BOTTOM_NAV_ITEMS])
  // Content languages come from config.json; the UI can only switch to those it has a locale for.
  const languages = config.languages.filter((l) => (UI_LANGUAGES as readonly string[]).includes(l))
  const current = i18n.language

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b bg-background px-4">
      <div className="flex min-w-0 items-center gap-1">
        {/* On a phone the sidebar is an off-canvas sheet: its own trigger is inside it. */}
        {isMobile && <SidebarTrigger className="-ml-1.5" aria-label={t('layout.header.toggle_sidebar')} />}
        <h1 className="truncate text-[13px] font-medium text-foreground">{active ? t(active.labelKey) : ''}</h1>
      </div>

      <div className="flex items-center gap-0.5">
        <DraftsIndicator />
        {languages.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1.5 text-xs" aria-label={t('layout.header.language')}>
                <Languages size={14} />
                {current.toUpperCase()}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" density="compact">
              {languages.map((lang) => (
                <DropdownMenuItem key={lang} onClick={() => setLanguage(lang)}>
                  <Check size={14} className={lang === current ? '' : 'invisible'} />
                  {lang.toUpperCase()}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <Button variant="ghost" size="icon-sm" onClick={toggleDarkMode} aria-label={t('layout.header.toggle_dark_mode')}>
          {darkMode ? <Sun size={15} /> : <Moon size={15} />}
        </Button>

        <div className="ml-1">
          <UserMenu />
        </div>
      </div>
    </header>
  )
}
