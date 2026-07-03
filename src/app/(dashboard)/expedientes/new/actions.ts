'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db } from '@/infrastructure/db/client'
import { expedientes, organizationMembers } from '@/infrastructure/db/schema'
import { authProvider } from '@/infrastructure/auth'
import { eq } from 'drizzle-orm'

import { isMunicipalityEnabled } from '@/shared/territory'

export async function createExpediente(formData: FormData) {
  const userId = await authProvider.getUserId()
  if (!userId) {
    redirect('/login')
  }

  // Verificar la organización del usuario
  let orgId: string | null = null;
  try {
    const memberships = await db.select().from(organizationMembers).where(eq(organizationMembers.profileId, userId))
    if (memberships.length > 0) {
      orgId = memberships[0].orgId
    }
  } catch (error) {
    console.error("Error querying memberships in createExpediente:", error)
  }

  if (!orgId) {
    redirect('/onboarding')
  }

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

  if (!name || name.trim() === '') {
    redirect('/expedientes/new?error=name_required')
  }
  if (!province || province.trim() === '' || !municipio || municipio.trim() === '') {
    redirect('/expedientes/new?error=territory_required')
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
      status: 'active'
    }).returning({ id: expedientes.id })

    newExpedienteId = newExpediente.id
  } catch (error) {
    console.error('Error creating expediente:', error)
    redirect('/expedientes/new?error=creation_failed')
  }

  revalidatePath('/dashboard')
  revalidatePath('/expedientes')
  
  redirect(`/expedientes/${newExpedienteId}`)
}
