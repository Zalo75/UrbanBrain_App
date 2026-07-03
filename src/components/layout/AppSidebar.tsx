'use client'

import Link from "next/link"
import { usePathname } from "next/navigation"
import { FolderOpen, Settings, LayoutDashboard, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"

interface AppSidebarProps {
  className?: string
  organization?: {
    name: string
    slug: string
  }
  userProfile?: {
    fullName: string | null
  }
}

export function AppSidebar({ className, organization }: AppSidebarProps) {
  const pathname = usePathname()

  const navItems = [
    {
      title: "Dashboard",
      href: "/dashboard",
      icon: LayoutDashboard,
      active: pathname === "/dashboard",
    },
    {
      title: "Expedientes",
      href: "/expedientes",
      icon: FolderOpen,
      active: pathname.startsWith("/expedientes"),
    },
    {
      title: "Ajustes",
      href: "/settings",
      icon: Settings,
      active: pathname.startsWith("/settings"),
    },
  ]

  const orgName = organization?.name || "Estudio"
  const orgInitials = orgName.substring(0, 2).toUpperCase()

  return (
    <aside className={cn("flex flex-col border-r bg-zinc-50 dark:bg-zinc-950/50", className)}>
      <div className="p-4">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-900 p-2 text-left transition-colors focus:outline-none">
            <Avatar className="h-8 w-8 rounded-md border shadow-sm">
              <AvatarFallback className="rounded-md bg-primary/10 text-primary text-xs font-medium">
                {orgInitials}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-1 flex-col overflow-hidden">
              <span className="truncate text-sm font-medium">{orgName}</span>
              <span className="truncate text-xs text-muted-foreground">Plan Freemium</span>
            </div>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>Cambiar de Estudio</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <div className="flex items-center gap-2">
                <Avatar className="h-5 w-5 rounded-sm">
                  <AvatarFallback className="rounded-sm text-[10px]">{orgInitials}</AvatarFallback>
                </Avatar>
                {orgName}
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Crear nueva organización...</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      
      <div className="px-4 py-2">
        <div className="text-xs font-semibold text-muted-foreground mb-2 px-2 uppercase tracking-wider">
          Menú
        </div>
        <nav className="space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/")
            return (
              <Link
                key={item.title}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-zinc-200/50 dark:bg-zinc-800/50 text-foreground"
                    : "text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900 hover:text-foreground"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.title}
              </Link>
            )
          })}
        </nav>
      </div>
    </aside>
  )
}
