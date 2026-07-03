import { redirect } from 'next/navigation'
import { db } from '@/infrastructure/db/client'
import { expedientes, organizationMembers, documents } from '@/infrastructure/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { authProvider } from '@/infrastructure/auth'
import { MapPin, Settings, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DocumentList } from './DocumentList'
import { formatLocationSource, formatLandClass, formatActionType } from '@/shared/utils/formatters'
import { getProvinceNameById, getMunicipalityNameById } from '@/shared/territory'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  const [expediente] = await db.select().from(expedientes).where(eq(expedientes.id, resolvedParams.id))
  if (!expediente) return { title: 'Expediente no encontrado - UrbanBrain' }
  return { title: `${expediente.name} - UrbanBrain` }
}

export default async function ExpedienteWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  const userId = await authProvider.getUserId()
  if (!userId) redirect('/login')

  const memberships = await db.select().from(organizationMembers).where(eq(organizationMembers.profileId, userId))
  if (memberships.length === 0) redirect('/onboarding')
  
  const orgId = memberships[0].orgId

  const [expediente] = await db
    .select()
    .from(expedientes)
    .where(and(eq(expedientes.id, resolvedParams.id), eq(expedientes.orgId, orgId)))

  if (!expediente) {
    redirect('/dashboard')
  }

  const expedienteDocs = await db
    .select()
    .from(documents)
    .where(eq(documents.expedienteId, expediente.id))
    .orderBy(desc(documents.uploadedAt))

  return (
    <div className="flex h-full w-full flex-col bg-background">
      {/* Workspace Header */}
      <div className="flex items-center justify-between border-b px-6 py-3 bg-zinc-50/50 dark:bg-zinc-950/20">
        <div className="flex items-center gap-4">
          <div className="flex flex-col">
            <h1 className="text-lg font-semibold tracking-tight">{expediente.name}</h1>
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {getMunicipalityNameById(expediente.municipio)}
              </span>
              {expediente.refCatastral && (
                <>
                  <span>•</span>
                  <span className="font-mono">{expediente.refCatastral}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-xs font-medium px-2.5 py-1 rounded-md bg-secondary text-secondary-foreground mr-2">
            {expediente.status === 'active' ? 'En progreso' : expediente.status}
          </div>
          <Button variant="outline" size="sm" className="h-8">
            <Settings className="h-4 w-4 mr-2" />
            Ajustes
          </Button>
        </div>
      </div>

      {/* Workspace Layout: Split Screen */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* Left Side: Context & Documents */}
        <div className="hidden lg:flex w-[350px] xl:w-[400px] flex-col border-r bg-zinc-50/30 dark:bg-zinc-950/30 overflow-y-auto">
          
          {/* Detalles Urbanísticos */}
          <div className="p-4 border-b">
            <h2 className="text-sm font-semibold flex items-center gap-2 mb-4">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              Detalles del Proyecto
            </h2>
            <div className="space-y-4 text-sm">
              {expediente.province && (
                <div>
                  <div className="text-xs text-muted-foreground font-medium mb-1">Provincia / Municipio</div>
                  <div className="font-medium">{getProvinceNameById(expediente.province)} / {getMunicipalityNameById(expediente.municipio)}</div>
                </div>
              )}
              
              {(expediente.address || (expediente.lat !== null && expediente.lng !== null) || expediente.locationSource) && (
                <div>
                  <div className="text-xs text-muted-foreground font-medium mb-1">Localización</div>
                  {expediente.address && <div className="mb-1">{expediente.address}</div>}
                  {expediente.lat !== null && expediente.lng !== null && (
                    <div className="font-mono text-xs">{expediente.lat.toFixed(5)}, {expediente.lng.toFixed(5)}</div>
                  )}
                  {expediente.locationSource && (
                    <div className="text-xs text-muted-foreground mt-1">Fuente: {formatLocationSource(expediente.locationSource)}</div>
                  )}
                </div>
              )}

              {(expediente.urbanPlanningZone || expediente.landClass || expediente.actionType) && (
                <div>
                  <div className="text-xs text-muted-foreground font-medium mb-1">Parámetros Urbanísticos</div>
                  <ul className="space-y-1.5">
                    {expediente.urbanPlanningZone && (
                      <li className="flex flex-col">
                        <span className="text-xs text-muted-foreground">Ámbito/Ordenanza:</span>
                        <span>{expediente.urbanPlanningZone}</span>
                      </li>
                    )}
                    {expediente.landClass && (
                      <li className="flex flex-col">
                        <span className="text-xs text-muted-foreground">Clase de suelo:</span>
                        <span>{formatLandClass(expediente.landClass)}</span>
                      </li>
                    )}
                    {expediente.actionType && (
                      <li className="flex flex-col">
                        <span className="text-xs text-muted-foreground">Actuación:</span>
                        <span>{formatActionType(expediente.actionType)}</span>
                      </li>
                    )}
                  </ul>
                </div>
              )}

              {expediente.notes && (
                <div>
                  <div className="text-xs text-muted-foreground font-medium mb-1">Notas</div>
                  <div className="text-xs bg-white dark:bg-zinc-900 p-2.5 rounded-md border whitespace-pre-wrap">
                    {expediente.notes}
                  </div>
                </div>
              )}
            </div>
          </div>

          <DocumentList 
            expedienteId={expediente.id} 
            orgId={orgId} 
            documents={expedienteDocs} 
          />
        </div>

        {/* Right Side: Chat / Main Interaction Area */}
        <div className="flex flex-1 flex-col relative">
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-lg mx-auto">
            <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-4">
              <MessageSquare className="h-5 w-5" />
            </div>
            <h2 className="text-xl font-semibold tracking-tight mb-2">Asistente Urbanístico</h2>
            <p className="text-sm text-muted-foreground mb-8">
              La IA está desconectada en este momento. Pronto podrás preguntar sobre normativas, parámetros urbanísticos y compatibilidad de usos para este expediente.
            </p>
            
            {/* Fake input just for the UI feel */}
            <div className="w-full relative shadow-sm">
              <textarea 
                className="w-full resize-none rounded-xl border bg-background px-4 py-4 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
                placeholder="Pregunta sobre la normativa de este municipio..."
                rows={1}
                disabled
              />
              <div className="absolute bottom-3 right-3">
                <Button disabled size="sm" className="h-8 w-8 rounded-lg p-0">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-send-horizontal"><path d="m3 3 3 9-3 9 19-9Z"/><path d="M6 12h16"/></svg>
                </Button>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
