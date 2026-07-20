'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, eq } from 'drizzle-orm'

import { hasOrganizationPermission } from '@/application/authorization/organizationRoles'
import { ContextDetectionEngine } from '@/application/context-engine/ContextDetectionEngine'
import { normalizeCadastralReference } from '@/application/territorial-resolver/resolveParcelLocation'
import { authProvider } from '@/infrastructure/auth'
import { db } from '@/infrastructure/db/client'
import { expedientes, municipalPlanning, organizationMembers } from '@/infrastructure/db/schema'
import { getMunicipalityById, getProvinceById } from '@/shared/territory'

import { getInitialContextAcceptance } from './creationContext'
import { getPreflightDetection, storePreflightDetection } from './preflightDetectionCache'
import {
  LAND_CLASS_OPTIONS,
  summarizeSmartCaseDetection,
  validateSmartCaseSubmission,
} from './smartCaseDetection'

type Membership = { orgId: string; role: 'owner' | 'admin' | 'member' | 'viewer' }

async function creatorMembership(userId: string): Promise<Membership | null> {
  const [membership] = await db
    .select({ orgId: organizationMembers.orgId, role: organizationMembers.role })
    .from(organizationMembers)
    .where(eq(organizationMembers.profileId, userId))
    .limit(1)
  return membership ?? null
}

function formText(formData: FormData, name: string) {
  const value = formData.get(name)
  return typeof value === 'string' ? value.trim() : ''
}

function coordinatesFromForm(formData: FormData) {
  const latRaw = formText(formData, 'lat')
  const lngRaw = formText(formData, 'lng')
  if (!latRaw && !lngRaw) return { lat: null, lng: null }
  if (!latRaw || !lngRaw) return null
  const lat = Number(latRaw)
  const lng = Number(lngRaw)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

function errorRedirect(error: string): never {
  redirect(`/expedientes/new?error=${error}`)
}

export async function createExpediente(formData: FormData) {
  const userId = await authProvider.getUserId()
  if (!userId) redirect('/login')

  let membership: Membership | null = null
  try {
    membership = await creatorMembership(userId)
  } catch {
    errorRedirect('creation_failed')
  }
  if (!membership) redirect('/onboarding')
  if (!hasOrganizationPermission(membership.role, 'expediente.create')) {
    errorRedirect('forbidden')
  }

  const name = formText(formData, 'name')
  const provinceId = formText(formData, 'province')
  const municipalityId = formText(formData, 'municipio')
  const refCatastral = normalizeCadastralReference(formText(formData, 'refCatastral'))
  const address = formText(formData, 'address')
  const coordinates = coordinatesFromForm(formData)
  const planeamiento = formText(formData, 'planeamiento')
  const urbanPlanningZone = formText(formData, 'urbanPlanningZone')
  const landClassRaw = formText(formData, 'landClass')
  const landClass = LAND_CLASS_OPTIONS.some((option) => option.value === landClassRaw)
    ? landClassRaw as (typeof LAND_CLASS_OPTIONS)[number]['value']
    : null
  const actionTypeRaw = formText(formData, 'actionType')
  const actionType = actionTypeRaw || null
  const notes = formText(formData, 'notes')
  const initialContextAcceptance = getInitialContextAcceptance(formData)

  if (!name) errorRedirect('name_required')
  if (!provinceId || !municipalityId) errorRedirect('territory_required')
  if (!getProvinceById(provinceId)?.enabled) errorRedirect('province_invalid')
  if (!initialContextAcceptance.noticeAccepted) errorRedirect('context_notice_required')
  if (!coordinates) errorRedirect('coordinates_invalid')
  if (!refCatastral && !address && coordinates.lat === null && coordinates.lng === null && !urbanPlanningZone) {
    errorRedirect('location_required')
  }
  const municipality = getMunicipalityById(municipalityId)
  if (!municipality?.enabled) errorRedirect('municipality_disabled')

  const cached = getPreflightDetection(userId, formText(formData, 'preflightDetectionId') || null)
  let preflight = cached ?? undefined
  const engine = new ContextDetectionEngine()

  // A cache miss can happen after a server restart or a request routed to another
  // process. Re-resolve before insertion instead of trusting client-populated data.
  if (!preflight && refCatastral) {
    try {
      preflight = summarizeSmartCaseDetection(
        await engine.detectStateless({ cadastralReference: refCatastral })
      )
    } catch {
      preflight = undefined
    }
  }

  const validationError = validateSmartCaseSubmission(
    {
      provinceId,
      municipalityId,
      cadastralReference: refCatastral,
      address,
      lat: coordinates.lat,
      lng: coordinates.lng,
      planeamiento,
      landClass,
      urbanPlanningZone,
    },
    preflight
  )
  if (validationError) errorRedirect(validationError)
  if (!preflight?.detected.planeamiento && planeamiento) {
    const rows = await db
      .select({ name: municipalPlanning.name })
      .from(municipalPlanning)
      .where(
        and(
          eq(municipalPlanning.municipalityId, municipality?.ineCode ?? ''),
          eq(municipalPlanning.status, 'vigente'),
          eq(municipalPlanning.name, planeamiento)
        )
      )
      .limit(1)
    if (!rows.length) errorRedirect('planning_invalid')
  }
  if (!landClass && landClassRaw) errorRedirect('land_class_invalid')

  let newExpedienteId: string
  try {
    const [newExpediente] = await db.insert(expedientes).values({
      orgId: membership.orgId,
      name,
      province: provinceId,
      municipio: municipalityId,
      address: address || null,
      refCatastral: refCatastral ?? null,
      lat: coordinates.lat,
      lng: coordinates.lng,
      location: coordinates.lat !== null && coordinates.lng !== null
        ? [coordinates.lng, coordinates.lat]
        : null,
      locationSource: preflight?.detected.locationSource ?? (coordinates.lat !== null ? 'coordinates' : address ? 'address' : 'manual'),
      urbanPlanningZone: urbanPlanningZone || null,
      landClass,
      actionType: actionType as typeof expedientes.$inferInsert.actionType,
      notes: notes || null,
      planeamiento: planeamiento || null,
      contextoValidadoPorTecnico: initialContextAcceptance.technicallyReviewed,
      status: 'active',
    }).returning({ id: expedientes.id })
    newExpedienteId = newExpediente.id

    try {
      if (preflight) {
        await engine.persistAuthorizedDetection(newExpedienteId, userId, preflight.result)
      } else {
        await engine.detectContext(newExpedienteId, userId)
      }
    } catch {
      // The expediente remains usable if a non-critical follow-up persistence fails.
    }
  } catch {
    errorRedirect('creation_failed')
  }

  revalidatePath('/dashboard')
  revalidatePath('/expedientes')
  redirect(`/expedientes/${newExpedienteId}`)
}

export async function detectContextAction(formData: FormData) {
  const userId = await authProvider.getUserId()
  if (!userId) return { error: 'Debe iniciar sesión para consultar fuentes territoriales.' }

  try {
    const membership = await creatorMembership(userId)
    if (!membership || !hasOrganizationPermission(membership.role, 'expediente.create')) {
      return { error: 'No dispone de permisos para preparar un expediente.' }
    }
  } catch {
    return { error: 'No se ha podido comprobar el acceso.' }
  }

  const refCatastral = normalizeCadastralReference(formText(formData, 'refCatastral'))
  if (!refCatastral) return { error: 'Debe introducir una referencia catastral válida.' }

  try {
    const engine = new ContextDetectionEngine()
    const detection = summarizeSmartCaseDetection(
      await engine.detectStateless({ cadastralReference: refCatastral })
    )
    const detectionId = storePreflightDetection(userId, detection)
    const clientDetection = {
      detected: detection.detected,
      progress: detection.progress,
      sourceChecks: detection.sourceChecks,
      affects: detection.affects,
    }
    return { detectionId, detection: clientDetection }
  } catch {
    return { error: 'No se ha podido completar la detección territorial. Inténtelo de nuevo.' }
  }
}

/** Returns only current, catalogued instruments for the selected municipality. */
export async function getPlanningOptionsAction(municipalityId: string) {
  const userId = await authProvider.getUserId()
  if (!userId) return []
  try {
    const membership = await creatorMembership(userId)
    if (!membership || !hasOrganizationPermission(membership.role, 'expediente.create')) return []
  } catch {
    return []
  }

  const municipality = getMunicipalityById(municipalityId)
  if (!municipality?.enabled || !municipality.ineCode) return []
  const rows = await db
    .select({ name: municipalPlanning.name })
    .from(municipalPlanning)
    .where(
      and(
        eq(municipalPlanning.municipalityId, municipality.ineCode),
        eq(municipalPlanning.status, 'vigente')
      )
    )
    .limit(20)
  return [...new Set(rows.map((row) => row.name).filter(Boolean))]
}
