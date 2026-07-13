import { redirect } from 'next/navigation'
import { authProvider } from '@/infrastructure/auth'
import { db } from '@/infrastructure/db/client'
import { expedientes, organizationMembers } from '@/infrastructure/db/schema'
import { eq, desc } from 'drizzle-orm'
import type { InferSelectModel } from 'drizzle-orm'
import { Button } from '@/components/ui/button'
import { Plus, FolderOpen } from 'lucide-react'
import Link from 'next/link'
import { formatActionType } from '@/shared/utils/formatters'
import { getProvinceNameById, getMunicipalityNameById } from '@/shared/territory'

export const metadata = {
  title: 'Dashboard - UrbanBrain',
}

type Expediente = InferSelectModel<typeof expedientes>

export default async function DashboardPage() {
  const userId = await authProvider.getUserId()
  if (!userId) {
    redirect('/login')
  }

  let hasMemberships = false;
  let recentExpedientes: Expediente[] = [];

  try {
    const memberships = await db.select().from(organizationMembers).where(eq(organizationMembers.profileId, userId))
    if (memberships.length > 0) {
      hasMemberships = true;
      const orgId = memberships[0].orgId

      recentExpedientes = await db
        .select()
        .from(expedientes)
        .where(eq(expedientes.orgId, orgId))
        .orderBy(desc(expedientes.createdAt))
        .limit(5)
    }
  } catch (error: unknown) {
    const err = error as Error & { code?: string };
    console.error("Database connection failed in DashboardPage:", err);
    // Para que no crashee, simulamos que tiene organización SOLO si es error de conexión
    if (err?.message?.includes('ECONNREFUSED') || err?.code === 'ECONNREFUSED' || err?.message?.includes('ENOTFOUND')) {
      hasMemberships = true;
    }
  }

  if (!hasMemberships) {
    redirect('/onboarding')
  }

  if (recentExpedientes.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center p-8">
        <div className="flex flex-col items-center justify-center space-y-4 text-center max-w-sm">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-900 border shadow-sm">
            <FolderOpen className="h-8 w-8 text-muted-foreground" strokeWidth={1.5} />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-xl font-semibold tracking-tight">Sin expedientes</h2>
            <p className="text-sm text-muted-foreground">
              Comienza creando tu primer expediente para analizar normativas, parcelas y documentos urbanísticos.
            </p>
          </div>
          <div className="pt-2">
            <Link href="/expedientes/new">
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Nuevo Expediente
              </Button>
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Actividad Reciente</h1>
            <p className="text-sm text-muted-foreground">Tus últimos expedientes modificados.</p>
          </div>
          <Link href="/expedientes/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Nuevo
            </Button>
          </Link>
        </div>

        <div className="grid gap-4">
          {recentExpedientes.map((exp) => (
            <div key={exp.id} className="flex items-center justify-between p-4 rounded-xl border bg-card hover:bg-accent/40 transition-colors cursor-pointer">
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-900 border">
                  <FolderOpen className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <h3 className="font-medium text-sm">{exp.name}</h3>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    <span>{getMunicipalityNameById(exp.municipio)}{exp.province ? `, ${getProvinceNameById(exp.province)}` : ''}</span>
                    {exp.refCatastral && (
                      <>
                        <span>•</span>
                        <span className="font-mono">{exp.refCatastral}</span>
                      </>
                    )}
                    {exp.actionType && (
                      <>
                        <span>•</span>
                        <span className="bg-muted px-1.5 py-0.5 rounded-sm">{formatActionType(exp.actionType)}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="text-xs font-medium px-2.5 py-1 rounded-md bg-secondary text-secondary-foreground">
                {exp.status === 'active' ? 'Activo' : exp.status}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
