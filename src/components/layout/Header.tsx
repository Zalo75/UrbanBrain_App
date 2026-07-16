'use client'

import { LogOut, User as UserIcon, WifiOff } from 'lucide-react'
import { usePathname } from 'next/navigation'

import { logout } from '@/app/(dashboard)/actions'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { cn } from '@/lib/utils'

interface HeaderProps {
  className?: string
  userProfile?: { fullName: string | null }
}

export function Header({ className, userProfile }: HeaderProps) {
  const isOnline = useOnlineStatus()
  const pathname = usePathname()
  const sectionName = pathname.split('/')[1] || 'dashboard'
  const formattedSection = sectionName.charAt(0).toUpperCase() + sectionName.slice(1)
  const userName = userProfile?.fullName || 'Usuario'
  const initials = userName.substring(0, 2).toUpperCase()

  return (
    <div className={cn('flex flex-col', className)}>
      {!isOnline && (
        <div className="bg-destructive text-destructive-foreground text-xs font-medium px-4 py-1.5 flex items-center justify-center gap-2">
          <WifiOff className="h-3.5 w-3.5" />
          Sin conexión a internet
        </div>
      )}
      <header className="flex h-14 items-center justify-between border-b bg-background px-4 lg:px-6">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-muted-foreground hidden md:inline-block">UrbanBrain</span>
          <span className="text-muted-foreground hidden md:inline-block">/</span>
          <span className="font-semibold text-sm">{formattedSection}</span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger className="focus:outline-none" aria-label="Menú de usuario">
            <Avatar className="h-8 w-8 cursor-pointer border hover:opacity-80 transition-opacity">
              <AvatarFallback className="bg-muted text-xs">{initials}</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{userName}</DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>
              <UserIcon className="mr-2 h-4 w-4" />
              <span>Perfil</span>
            </DropdownMenuItem>
            <form action={logout} className="w-full">
              <DropdownMenuItem
                render={<button type="submit" className="w-full" />}
                nativeButton
                className="text-red-600 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-950"
              >
                <LogOut className="mr-2 h-4 w-4" />
                <span>Cerrar sesión</span>
              </DropdownMenuItem>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
    </div>
  )
}
