import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'
import { KeyRound, KeySquare, Link2, LogIn, LogOut, UserPen } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ApiTokensDialog } from '@/features/account/api-tokens-dialog'
import { ChangePasswordDialog } from '@/features/account/change-password-dialog'
import { LinkedAccountsDialog } from '@/features/account/linked-accounts-dialog'
import { ProfileDialog } from '@/features/account/profile-dialog'
import { isServerMode } from '@/lib/api-client'
import { displayName, initials, useAuthStore } from '@/stores/auth-store'

/** Server mode: "Log in" for an anonymous reader, else the account menu. Static mode has no accounts. */
export function UserMenu() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const [profileOpen, setProfileOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [tokensOpen, setTokensOpen] = useState(false)
  const [linkedOpen, setLinkedOpen] = useState(false)

  if (!isServerMode()) return null

  if (!user) {
    return (
      <Button variant="outline" size="sm" onClick={() => navigate('/login', { state: { from: location } })}>
        <LogIn size={14} />
        {t('auth.menu.login')}
      </Button>
    )
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label={t('auth.menu.user_menu')}>
            <Avatar className="h-7 w-7">
              <AvatarFallback className="bg-primary text-[10px] font-medium text-primary-foreground">
                {initials(user)}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" density="compact" className="min-w-48">
          <DropdownMenuLabel className="space-y-0.5">
            <div className="truncate text-xs font-medium text-foreground">{displayName(user)}</div>
            <div className="truncate text-[10px] font-normal text-muted-foreground">
              {user.username} · {t('auth.menu.role', { role: user.role })}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setProfileOpen(true)}>
            <UserPen size={14} />
            {t('auth.menu.profile')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setPasswordOpen(true)}>
            <KeyRound size={14} />
            {t('auth.menu.change_password')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setLinkedOpen(true)}>
            <Link2 size={14} />
            {t('account.menu.linked')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTokensOpen(true)}>
            <KeySquare size={14} />
            {t('account.menu.api_tokens')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={logout}>
            <LogOut size={14} />
            {t('auth.menu.logout')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
      <LinkedAccountsDialog open={linkedOpen} onOpenChange={setLinkedOpen} />
      <ApiTokensDialog open={tokensOpen} onOpenChange={setTokensOpen} />
    </>
  )
}
