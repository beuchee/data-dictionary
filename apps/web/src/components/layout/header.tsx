import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'
import { Check, Languages, LogIn, Moon, Sun, User } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { isServerMode } from '@/lib/api-client'
import { UI_LANGUAGES } from '@/lib/i18n'
import { useAppStore } from '@/stores/app-store'
import { useInstanceConfig } from '@/stores/config-store'
import { BOTTOM_NAV_ITEMS, activeNavItem, mainNavItems } from './nav-items'

export function Header() {
  const { t, i18n } = useTranslation()
  const { pathname } = useLocation()
  const config = useInstanceConfig()
  const darkMode = useAppStore((s) => s.darkMode)
  const toggleDarkMode = useAppStore((s) => s.toggleDarkMode)
  const setLanguage = useAppStore((s) => s.setLanguage)

  const active = activeNavItem(pathname, [...mainNavItems(config), ...BOTTOM_NAV_ITEMS])
  // Content languages come from config.json; the UI can only switch to those it has a locale for.
  const languages = config.languages.filter((l) => (UI_LANGUAGES as readonly string[]).includes(l))
  const current = i18n.language

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b bg-background px-4">
      <h1 className="text-[13px] font-medium text-foreground">{active ? t(active.labelKey) : ''}</h1>

      <div className="flex items-center gap-0.5">
        {languages.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1.5 text-xs" aria-label={t('header.language')}>
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

        <Button variant="ghost" size="icon-sm" onClick={toggleDarkMode} aria-label={t('header.toggle_dark_mode')}>
          {darkMode ? <Sun size={15} /> : <Moon size={15} />}
        </Button>

        {/* TODO(v2-auth): user menu (profile, logout) once the API has auth. */}
        <div className="ml-1">
          {isServerMode() ? (
            <Button variant="outline" size="sm" className="gap-1.5 text-xs">
              <LogIn size={14} />
              {t('header.login')}
            </Button>
          ) : (
            <Avatar className="h-7 w-7" aria-label={t('header.user_menu')}>
              <AvatarFallback className="bg-muted text-muted-foreground">
                <User size={14} />
              </AvatarFallback>
            </Avatar>
          )}
        </div>
      </div>
    </header>
  )
}
