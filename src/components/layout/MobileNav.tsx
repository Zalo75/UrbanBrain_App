'use client'

import Link from "next/link"
import { usePathname } from "next/navigation"
import { FolderOpen, Settings, LayoutDashboard } from "lucide-react"
import { cn } from "@/lib/utils"

export function MobileNav({ className }: { className?: string }) {
  const pathname = usePathname()

  const navItems = [
    { name: "Inicio", href: "/dashboard", icon: LayoutDashboard },
    { name: "Expedientes", href: "/expedientes", icon: FolderOpen },
    { name: "Ajustes", href: "/settings", icon: Settings },
  ]

  return (
    <nav className={cn("flex items-center justify-around border-t bg-background px-2 pb-safe", className)}>
      {navItems.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(item.href + "/")
        return (
          <Link
            key={item.name}
            href={item.href}
            className={cn(
              "flex flex-col items-center justify-center p-2 text-xs font-medium transition-colors",
              isActive ? "text-primary" : "text-muted-foreground"
            )}
          >
            <item.icon className="mb-1 h-5 w-5" />
            {item.name}
          </Link>
        )
      })}
    </nav>
  )
}
