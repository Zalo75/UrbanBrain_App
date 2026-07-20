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
  type PreflightDetection,
  validateSmartCaseSubmission,
} from './smartCaseDetection'

type Membership = { orgId: string; role: 'owner' | 'admin' | 'member' | 'viewer' }

export interface CreateExpedienteState {
  status: 'idle' | 'error'
  message?: string
  field?: 'name' | 'province' | 'municipio' | 'refCatastral' | 'address' | 'coordinates' | 'planeamiento' | 'landClass' | 'contextNotice' | 'territorialContext'
}

export const initialCreateExpedienteState: CreateExpedienteState = { status: 'idle' }

function creationError(
  message: string,
  field?: CreateExpedienteState['field']
): CreateExpedienteState {
  return { status: 'error', message, field }
}

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

function detectionMismatchField(
  detection: PreflightDetection | undefined,
  input: {
    provinceId: string
    municipalityId: string
    cadastralReference: string | null
    address: string
    lat: number | null
    lng: number | null
    planeamiento: string
    landClass: string | null
    urbanPlanningZone: string
  }
): CreateExpedienteState['field'] {
  const expected = detection?.detected
  if (!expected) return 'territorialContext'
  if (expected.cadastralReference && input.cadastralReference !== expected.cadastralReference) return 'refCatastral'
  if (expected.provinceId && input.provinceId !== expected.provinceId) return 'province'
  if (expected.municipalityId && input.municipalityId !== expected.municipalityId) return 'municipio'
  if (expected.address && input.address !== expected.address) return 'address'
  if (expected.lat !== undefined && input.lat !== expected.lat) return 'coordinates'
  if (expected.lng !== undefined && input.lng !== expected.lng) return 'coordinates'
  if (expected.planeamiento && input.planeamiento !== expected.planeamiento) return 'planeamiento'
  if (expected.landClass && input.landClass !== expected.landClass) return 'landClass'
  return 'territorialContext'
}

export async function createExpediente(
  _previousState: CreateExpedienteState,
  formData: FormData
): Promise<CreateExpedienteState> {
  const userId = await authProvider.getUserId()
  if (!userId) redirect('/login')

  let membership: Membership | null = null
  try {
    membership = await creatorMembership(userId)
  } catch {
    return creationError('No hemos podido preparar la creación del expediente. Inténtelo de nuevo.')
  }
  if (!membership) redirect('/onboarding')
  if (!hasOrganizationPermission(membership.role, 'expediente.create')) {
    return creationError('No dispone de permisos para crear expedientes.')
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

  if (!name) return creationError('Indique un nombre para identificar el expediente.', 'name')
  if (!provinceId || !municipalityId) {
    return creationError('Seleccione la provincia y el municipio antes de crear el expediente.', 'municipio')
  }
  if (!getProvinceById(provinceId)?.enabled) {
    return creationError('La provincia seleccionada no está disponible para esta beta.', 'province')
  }
  if (!initialContextAcceptance.noticeAccepted) {
    return creationError('Confirme que el contexto inicial debe validarse técnicamente.', 'contextNotice')
  }
  if (!coordinates) {
    return creationError('Introduzca latitud y longitud juntas, o deje ambos campos vacíos.', 'coordinates')
  }
  if (!refCatastral && !address && coordinates.lat === null && coordinates.lng === null && !urbanPlanningZone) {
    return creationError('Indique una referencia catastral, una dirección o unas coordenadas para localizar el expediente.', 'refCatastral')
  }
  const municipality = getMunicipalityById(municipalityId)
  if (!municipality?.enabled) {
    return creationError('El municipio seleccionado no está disponible. Revise la provincia y el municipio.', 'municipio')
  }
  if (formText(formData, 'territorialDetectionInvalidated') === 'true') {
    return creationError('Los datos de localización han cambiado. Actualice la detección antes de crear el expediente.', 'territorialContext')
  }

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
      return creationError('No se ha podido verificar la detección territorial. Actualice el análisis antes de crear el expediente.', 'refCatastral')
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
  if (validationError) {
    if (validationError === 'municipality_province_mismatch') {
      return creationError('El municipio no pertenece a la provincia seleccionada. Revise ambos campos.', 'municipio')
    }
    if (validationError === 'detection_mismatch') {
      const field = detectionMismatchField(preflight, {
        provinceId,
        municipalityId,
        cadastralReference: refCatastral,
        address,
        lat: coordinates.lat,
        lng: coordinates.lng,
        planeamiento,
        landClass,
        urbanPlanningZone,
      })
      return creationError('Los datos no coinciden con la detección territorial verificada. Actualice el análisis antes de crear el expediente.', field)
    }
    return creationError('Revise el municipio seleccionado antes de crear el expediente.', 'municipio')
  }
  if (!preflight && (landClass || urbanPlanningZone)) {
    return creationError('La clasificación o el ámbito deben proceder de una detección territorial verificada. Actualice el análisis antes de crear el expediente.', 'territorialContext')
  }
  if (!preflight?.detected.planeamiento && planeamiento) {
    try {
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
      if (!rows.length) {
        return creationError('El planeamiento seleccionado ya no está disponible para este municipio. Seleccione otra opción o déjelo pendiente.', 'planeamiento')
      }
    } catch {
      return creationError('No se ha podido comprobar el planeamiento seleccionado. Puede dejarlo pendiente e intentarlo más tarde.', 'planeamiento')
    }
  }
  if (!landClass && landClassRaw) {
    return creationError('La clasificación seleccionada no es válida. Elija una opción de la lista.', 'landClass')
  }

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
    return creationError('No se ha podido crear el expediente. Sus datos siguen en el formulario; inténtelo de nuevo.')
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
