import { redirect } from 'next/navigation'
import { db } from '@/infrastructure/db/client'
import { contextDetections, documents } from '@/infrastructure/db/schema'
import { eq, desc } from 'drizzle-orm'
import { MapPin, Settings, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DocumentList } from './DocumentList'
import { formatLocationSource, formatLandClass, formatActionType } from '@/shared/utils/formatters'
import { getProvinceNameById, getMunicipalityNameById } from '@/shared/territory'
import { ChatInterface } from './ChatInterface'
import { getExpedienteAccess } from '@/application/authorization/expedienteAccess'
import { buildTerritorialContextView } from '@/application/territorial-resolver/territorialContextView'
import { TerritorialContextPanel } from './TerritorialContextPanel'
import { latestContextDetectionOrder } from '@/infrastructure/db/contextDetectionOrdering'
import { buildTerritorialPresentation } from './territorialPresentation'
import { ExpedienteActions } from '@/components/expedientes/ExpedienteActions'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  const access = await getExpedienteAccess(resolvedParams.id)
  if (!access.ok) return { title: 'Expediente - UrbanBrain' }
  return { title: `${access.expediente.name} - UrbanBrain` }
}

export default async function ExpedienteWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  const access = await getExpedienteAccess(resolvedParams.id)
  if (!access.ok && access.reason === 'unauthenticated') redirect('/login')
  if (!access.ok) {
    redirect('/dashboard')
  }

  const { expediente, membershipRole } = access

  const [expedienteDocs, latestDetections] = await Promise.all([
    db
      .select()
      .from(documents)
      .where(eq(documents.expedienteId, expediente.id))
      .orderBy(desc(documents.uploadedAt)),
    db
      .select({ rawResponse: contextDetections.rawResponse })
      .from(contextDetections)
      .where(eq(contextDetections.expedienteId, expediente.id))
      .orderBy(...latestContextDetectionOrder())
      .limit(1),
  ])
  const territorialContext = buildTerritorialContextView(
    latestDetections[0]?.rawResponse ?? null
  )
  const presentation = buildTerritorialPresentation(
    {
      province: expediente.province ? getProvinceNameById(expediente.province) : '',
      municipality: getMunicipalityNameById(expediente.municipio),
      address: expediente.address,
      lat: expediente.lat,
      lng: expediente.lng,
      planning: expediente.planeamiento,
      zone: expediente.urbanPlanningZone,
      landClass: expediente.landClass ? formatLandClass(expediente.landClass) : null,
    },
    territorialContext
  )
  const displayedProvince = presentation.province
  const displayedMunicipality = presentation.municipality
  const displayedAddress = presentation.address
  const displayedCoordinates = presentation.coordinates
  const technicallyReviewed = presentation.technicallyReviewed
  const displayedReference = territorialContext?.cadastralReference ?? expediente.refCatastral
  const displayedPlanning = presentation.planning
  const displayedZone = presentation.zone
  const displayedLandClass = presentation.landClass

  return (
    <div className="flex h-full w-full flex-col bg-background">
      {/* Workspace Header */}
      <div className="flex items-center justify-between border-b px-4 lg:px-6 py-3 bg-zinc-50/50 dark:bg-zinc-950/20 gap-2 min-w-0">
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <div className="flex flex-col min-w-0">
            <h1 className="text-lg font-semibold tracking-tight truncate">{expediente.name}</h1>
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5 truncate">
              <span className="flex items-center gap-1 shrink-0">
                <MapPin className="h-3 w-3" />
                <span className="truncate">{displayedMunicipality}</span>
              </span>
              {displayedReference && (
                <>
                  <span className="shrink-0">•</span>
                  <span className="font-mono truncate">{displayedReference}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="text-[10px] sm:text-xs font-medium px-2 py-1 rounded-md bg-secondary text-secondary-foreground whitespace-nowrap">
            {expediente.status === 'active' ? 'En progreso' : expediente.status}
          </div>
          <Button variant="outline" size="sm" className="h-8 hidden sm:flex">
            <Settings className="h-4 w-4 mr-2" />
            Ajustes
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8 sm:hidden shrink-0">
            <Settings className="h-4 w-4" />
          </Button>
          <ExpedienteActions expediente={expediente} membershipRole={membershipRole} />
        </div>
      </div>

      <TerritorialContextPanel
        expedienteId={expediente.id}
        initialInput={{
          cadastralReference: displayedReference,
          address: displayedAddress,
          lat: displayedCoordinates?.lat ?? null,
          lng: displayedCoordinates?.lng ?? null,
        }}
        context={territorialContext}
      />

      {expediente.status === 'territorial_context_pending' && (
        <div role="alert" className="mx-4 mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200 lg:mx-6">
          El expediente se creó, pero la confirmación territorial quedó pendiente. Revise o actualice el contexto antes de utilizar datos urbanísticos.
        </div>
      )}

      {/* Workspace Layout: Split Screen */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* Left Side: Context & Documents */}
        <div className="hidden lg:flex w-[350px] xl:w-[400px] flex-col border-r bg-zinc-50/30 dark:bg-zinc-950/30 overflow-y-auto">
          
          {/* Detalles Urbanísticos */}
          <div className="p-4 border-b">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                Detalles del Proyecto
              </h2>
              {technicallyReviewed ? (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                  Contexto revisado
                </span>
              ) : (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                  Pendiente de revisión
                </span>
              )}
            </div>
            <div className="space-y-4 text-sm">
              {expediente.province && (
                <div>
                  <div className="text-xs text-muted-foreground font-medium mb-1">Provincia / Municipio</div>
                  <div className="font-medium">{displayedProvince} / {displayedMunicipality}</div>
                </div>
              )}
              
              {(displayedAddress || displayedCoordinates || expediente.locationSource) && (
                <div>
                  <div className="text-xs text-muted-foreground font-medium mb-1">Localización</div>
                  {displayedAddress && <div className="mb-1">{displayedAddress}</div>}
                  {displayedCoordinates && (
                    <div className="font-mono text-xs">{displayedCoordinates.lat.toFixed(6)}, {displayedCoordinates.lng.toFixed(6)}</div>
                  )}
                  {!territorialContext && expediente.locationSource && (
                    <div className="text-xs text-muted-foreground mt-1">Fuente: {formatLocationSource(expediente.locationSource)}</div>
                  )}
                </div>
              )}

              {(displayedPlanning || displayedZone || displayedLandClass || expediente.actionType) && (
                <div>
                  <div className="text-xs text-muted-foreground font-medium mb-1">Parámetros Urbanísticos</div>
                  <ul className="space-y-1.5">
                    {displayedPlanning && (
                      <li className="flex flex-col">
                        <span className="text-xs text-muted-foreground">Planeamiento:</span>
                        <span className="font-medium">{displayedPlanning}</span>
                      </li>
                    )}
                    {displayedZone && (
                      <li className="flex flex-col">
                        <span className="text-xs text-muted-foreground">Ámbito/Ordenanza:</span>
                        <span>{displayedZone}</span>
                      </li>
                    )}
                    {displayedLandClass && (
                      <li className="flex flex-col">
                        <span className="text-xs text-muted-foreground">Clase de suelo:</span>
                        <span>{displayedLandClass}</span>
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
            documents={expedienteDocs} 
            membershipRole={membershipRole}
          />
        </div>

        {/* Right Side: Chat / Main Interaction Area */}
        <div className="flex flex-1 flex-col relative bg-background min-w-0">
          {technicallyReviewed ? (
            <div className="bg-emerald-50 dark:bg-emerald-950/40 border-b border-emerald-200 dark:border-emerald-900 p-2.5 text-xs text-emerald-800 dark:text-emerald-400 flex items-start sm:items-center justify-center gap-2 shrink-0">
              <MapPin className="h-4 w-4 mt-0.5 sm:mt-0 shrink-0" />
              <span className="min-w-0 break-words leading-relaxed text-center text-[11px] sm:text-xs">UrbanBrain utilizará este contexto para responder a las consultas de este expediente.</span>
            </div>
          ) : (
            <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900 p-2.5 text-xs text-amber-800 dark:text-amber-400 flex items-start sm:items-center justify-center gap-2 shrink-0">
              <AlertCircle className="h-4 w-4 mt-0.5 sm:mt-0 shrink-0" />
              <span className="min-w-0 break-words leading-relaxed text-center text-[11px] sm:text-xs">Revise que el ayuntamiento, el planeamiento y las afecciones aplicables corresponden a este expediente.</span>
            </div>
          )}
          <ChatInterface expedienteId={expediente.id} />
        </div>

      </div>
    </div>
  )
}
