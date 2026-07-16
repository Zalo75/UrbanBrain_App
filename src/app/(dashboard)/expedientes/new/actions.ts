'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db } from '@/infrastructure/db/client'
import { expedientes, organizationMembers } from '@/infrastructure/db/schema'
import { authProvider } from '@/infrastructure/auth'
import { eq } from 'drizzle-orm'
import { hasOrganizationPermission } from '@/application/authorization/organizationRoles'
import { getInitialContextAcceptance } from './creationContext'

import { isMunicipalityEnabled, getProvinceByName, getMunicipalityByName } from '@/shared/territory'

export async function createExpediente(formData: FormData) {
  const userId = await authProvider.getUserId()
  if (!userId) {
    redirect('/login')
  }

  // Verificar la organización del usuario
  let membership: { orgId: string; role: 'owner' | 'admin' | 'member' | 'viewer' } | null = null
  try {
    const [result] = await db
      .select({ orgId: organizationMembers.orgId, role: organizationMembers.role })
      .from(organizationMembers)
      .where(eq(organizationMembers.profileId, userId))
      .limit(1)
    membership = result ?? null
  } catch (error) {
    console.error("Error querying memberships in createExpediente:", error)
  }

  if (!membership) {
    redirect('/onboarding')
  }
  if (!hasOrganizationPermission(membership.role, 'expediente.create')) {
    redirect('/expedientes?error=forbidden')
  }
  const orgId = membership.orgId

  const name = formData.get('name') as string
  const province = formData.get('province') as string
  const municipio = formData.get('municipio') as string
  const refCatastral = formData.get('refCatastral') as string | null
  const address = formData.get('address') as string | null
  const latStr = formData.get('lat') as string | null
  const lngStr = formData.get('lng') as string | null
  const locationSourceRaw = formData.get('locationSource') as string | null
  const locationSource = locationSourceRaw ? locationSourceRaw as 'cadastral_reference' | 'address' | 'coordinates' | 'planning_area' | 'manual' : null
  const urbanPlanningZone = formData.get('urbanPlanningZone') as string | null
  const landClassRaw = formData.get('landClass') as string | null
  const landClass = landClassRaw ? landClassRaw as 'desconocido' | 'urbano_consolidado' | 'urbano_no_consolidado' | 'urbanizable' | 'rustico_no_urbanizable' | 'nucleo_rural' : null
  const actionTypeRaw = formData.get('actionType') as string | null
  const actionType = actionTypeRaw ? actionTypeRaw as 'consulta_urbanistica' | 'vivienda_unifamiliar' | 'reforma' | 'segregacion' | 'cambio_de_uso' | 'nave' | 'legalizacion' | 'demolicion' | 'parcelacion' | 'informe_urbanistico' | 'otro' : null
  const notes = formData.get('notes') as string | null
  const planeamiento = formData.get('planeamiento') as string | null
  const initialContextAcceptance = getInitialContextAcceptance(formData)

  if (!name || name.trim() === '') {
    redirect('/expedientes/new?error=name_required')
  }
  if (!province || province.trim() === '' || !municipio || municipio.trim() === '') {
    redirect('/expedientes/new?error=territory_required')
  }
  if (!initialContextAcceptance.noticeAccepted) {
    redirect('/expedientes/new?error=context_notice_required')
  }

  if (!isMunicipalityEnabled(municipio)) {
    redirect('/expedientes/new?error=municipality_disabled')
  }

  let lat: number | null = null
  let lng: number | null = null
  if (latStr || lngStr) {
    if (!latStr || !lngStr) {
      redirect('/expedientes/new?error=coordinates_incomplete')
    }
    lat = parseFloat(latStr)
    lng = parseFloat(lngStr)
    if (isNaN(lat) || isNaN(lng)) {
      redirect('/expedientes/new?error=coordinates_invalid')
    }
  }

  const hasLocation = 
    (refCatastral && refCatastral.trim() !== '') || 
    (address && address.trim() !== '') || 
    (lat !== null && lng !== null) ||
    (urbanPlanningZone && urbanPlanningZone.trim() !== '')

  if (!hasLocation) {
    redirect('/expedientes/new?error=location_required')
  }

  let newExpedienteId: string

  try {
    const [newExpediente] = await db.insert(expedientes).values({
      orgId,
      name: name.trim(),
      province: province.trim(),
      municipio: municipio.trim(),
      address: address ? address.trim() : null,
      refCatastral: refCatastral ? refCatastral.trim() : null,
      lat,
      lng,
      location: (lat !== null && lng !== null) ? [lng, lat] : null,
      locationSource,
      urbanPlanningZone: urbanPlanningZone ? urbanPlanningZone.trim() : null,
      landClass,
      actionType,
      notes: notes ? notes.trim() : null,
      planeamiento: planeamiento ? planeamiento.trim() : null,
      contextoValidadoPorTecnico: initialContextAcceptance.technicallyReviewed,
      status: 'active'
    }).returning({ id: expedientes.id })

    newExpedienteId = newExpediente.id
    
    // Guardar la detección en context_detections usando el motor
    try {
      const { ContextDetectionEngine } = await import('@/application/context-engine/ContextDetectionEngine')
      const engine = new ContextDetectionEngine()
      // Se ejecuta en background (no usamos await para no bloquear la redirección de inmediato)
      // O usamos await si queremos garantizar que termine antes de redirigir
      await engine.detectContext(newExpedienteId, userId)
    } catch (engineError) {
      console.error('Error in ContextDetectionEngine during creation:', engineError)
      // No interrumpimos la creación del expediente por un fallo en el motor
    }
  } catch (error) {
    console.error('Error creating expediente:', error)
    redirect('/expedientes/new?error=creation_failed')
  }

  revalidatePath('/dashboard')
  revalidatePath('/expedientes')
  
  redirect(`/expedientes/${newExpedienteId}`)
}

export async function detectContextAction(formData: FormData) {
  const userId = await authProvider.getUserId()
  if (!userId) {
    return { error: "Debe iniciar sesión para consultar fuentes territoriales." }
  }
  const refCatastral = formData.get('refCatastral') as string | null
  
  if (!refCatastral || refCatastral.trim() === '') {
    return { error: "Debe introducir una referencia catastral." }
  }

  const rc = refCatastral.trim().toUpperCase()
  
  try {
    const { ContextDetectionEngine } = await import('@/application/context-engine/ContextDetectionEngine')
    const engine = new ContextDetectionEngine()
    const result = await engine.detectStateless(rc)
    
    if (result.status === 'unresolved') {
      return {
        error:
          result.warnings[0]?.message ??
          "No se ha podido resolver la referencia catastral.",
      }
    }
    
    return {
      provinceId: getProvinceByName(result.province ?? '')?.id ?? null,
      municipalityId: getMunicipalityByName(result.municipality ?? '')?.id ?? null,
      provinceName: result.province ?? null,
      municipalityName: result.municipality ?? null,
      address: result.normalizedAddress ?? null
    }
  } catch (e) {
    console.error('Error in detectContextAction:', e)
    return { error: "Error interno al detectar contexto urbanístico." }
  }
}
