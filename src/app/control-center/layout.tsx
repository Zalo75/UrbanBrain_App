import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import {
  isPlatformAuthorizationError,
  requirePlatformPermission,
} from '@/application/authorization/platformAccess'

export const metadata: Metadata = {
  title: 'Control Center | UrbanBrain',
  robots: { index: false, follow: false, noarchive: true },
}

const navigation = ['Resumen', 'Clientes', 'Conversaciones', 'Cobertura', 'Sistema']

export default async function ControlCenterLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  let admin

  try {
    admin = await requirePlatformPermission('control_center.access')
  } catch (error) {
    if (isPlatformAuthorizationError(error)) {
      if (error.code === 'unauthenticated') {
        redirect('/login?next=/control-center')
      }
      notFound()
    }
    throw error
  }

  return (
    <div className="bg-background min-h-[100dvh]">
      <header className="border-b bg-slate-950 text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-emerald-300 uppercase">
              Administración de plataforma
            </p>
            <h1 className="mt-1 text-xl font-semibold">UrbanBrain Control Center</h1>
          </div>
          <div className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm">
            <p className="font-medium">{admin.fullName ?? 'Perfil administrativo'}</p>
            <p className="text-slate-300">
              Rol: <span className="font-mono">{admin.role}</span>
            </p>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-5 py-6 sm:px-8 lg:grid-cols-[220px_1fr]">
        <aside aria-label="Navegación del Control Center">
          <nav className="rounded-xl border bg-white p-3 shadow-sm dark:bg-slate-950">
            <ul className="space-y-1">
              {navigation.map((item, index) => (
                <li key={item}>
                  <div
                    aria-current={index === 0 ? 'page' : undefined}
                    className={
                      index === 0
                        ? 'rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white'
                        : 'flex items-center justify-between rounded-lg px-3 py-2 text-sm text-slate-500'
                    }
                  >
                    <span>{item}</span>
                    {index > 0 && <span className="text-[10px] uppercase">Próximamente</span>}
                  </div>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <main>{children}</main>
      </div>
    </div>
  )
}
