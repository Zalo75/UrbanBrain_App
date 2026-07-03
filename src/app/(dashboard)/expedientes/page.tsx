import { redirect } from 'next/navigation'
import { authProvider } from '@/infrastructure/auth'
import { db } from '@/infrastructure/db/client'
import { expedientes, organizationMembers } from '@/infrastructure/db/schema'
import { eq, desc, ne, and } from 'drizzle-orm'
import { Button } from '@/components/ui/button'
import { Plus, FolderOpen, MapPin } from 'lucide-react'
import Link from 'next/link'
import { ExpedienteActions } from '@/components/expedientes/ExpedienteActions'

export const metadata = {
  title: 'Expedientes - UrbanBrain',
}

export default async function ExpedientesListPage() {
  const userId = await authProvider.getUserId()
  if (!userId) redirect('/login')

  const memberships = await db.select().from(organizationMembers).where(eq(organizationMembers.profileId, userId))
  if (memberships.length === 0) redirect('/onboarding')
  
  const orgId = memberships[0].orgId

  const expedientesList = await db
    .select()
    .from(expedientes)
    .where(and(eq(expedientes.orgId, orgId), ne(expedientes.status, 'archived')))
    .orderBy(desc(expedientes.createdAt))

  if (expedientesList.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center p-8">
        <div className="flex flex-col items-center justify-center space-y-4 text-center max-w-sm">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-900 border shadow-sm">
            <FolderOpen className="h-8 w-8 text-muted-foreground" strokeWidth={1.5} />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-xl font-semibold tracking-tight">No hay expedientes activos</h2>
            <p className="text-sm text-muted-foreground">
              Crea un expediente para organizar tus referencias catastrales, normativas y consultas.
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
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Expedientes</h1>
          <p className="text-sm text-muted-foreground">Todos los expedientes activos de tu estudio.</p>
        </div>
        <Link href="/expedientes/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Nuevo
          </Button>
        </Link>
      </div>

      <div className="rounded-xl border bg-card">
        {/* Header de la lista (Desktop) */}
        <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-4 p-4 border-b text-sm font-medium text-muted-foreground bg-muted/40">
          <div>Nombre del Proyecto</div>
          <div>Municipio</div>
          <div>Ref. Catastral</div>
          <div>Fecha de creación</div>
          <div className="w-8"></div>
        </div>
        
        {/* Filas */}
        <div className="divide-y">
          {expedientesList.map((exp) => (
            <div key={exp.id} className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr_auto] gap-4 p-4 items-center hover:bg-accent/40 transition-colors">
              {/* Nombre - clickable */}
              <Link href={`/expedientes/${exp.id}`} className="flex items-center gap-3 group">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <FolderOpen className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-medium text-sm group-hover:underline">{exp.name}</div>
                  <div className="text-xs text-muted-foreground md:hidden flex items-center mt-0.5">
                    <MapPin className="h-3 w-3 mr-1 inline" />
                    {exp.municipio}
                  </div>
                </div>
              </Link>
              
              {/* Resto de columnas (Desktop) */}
              <div className="hidden md:flex items-center text-sm text-muted-foreground">
                <MapPin className="h-3.5 w-3.5 mr-1.5" />
                {exp.municipio}
              </div>
              
              <div className="hidden md:block text-sm text-muted-foreground font-mono">
                {exp.refCatastral || '—'}
              </div>

              <div className="hidden md:block text-sm text-muted-foreground">
                {exp.createdAt.toLocaleDateString('es-ES', { 
                  year: 'numeric', month: 'short', day: 'numeric' 
                })}
              </div>

              {/* Acciones */}
              <div className="flex justify-end">
                <ExpedienteActions expediente={exp} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
