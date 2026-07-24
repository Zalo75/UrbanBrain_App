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
import type { CreateExpedienteState } from './creationState'
import { getPreflightDetection, storePreflightDetection } from './preflightDetectionCache'
import {
  LAND_CLASS_OPTIONS,
  summarizeSmartCaseDetection,
  type PreflightDetection,
  validateSmartCaseSubmission,
} from './smartCaseDetection'

type Membership = { orgId: string; role: 'owner' | 'admin' | 'member' | 'viewer' }

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
  return 'territorialContext'
}

type TerritorialInputSource = 'cadastral_reference' | 'coordinates' | 'address'

function territorialInputSource(formData: FormData): TerritorialInputSource | null {
  const value = formText(formData, 'territorialInputSource')
  return value === 'cadastral_reference' || value === 'coordinates' || value === 'address'
    ? value
    : null
}

/**
 * A detection must have one canonical location input. In particular, never mix
 * a newly entered cadastral reference with coordinates auto-filled for a
 * previous parcel.
 */
function resolutionInputFromForm({
  source,
  cadastralReference,
  coordinates,
  address,
}: {
  source: TerritorialInputSource | null
  cadastralReference: string | null
  coordinates: { lat: number | null; lng: number | null } | null
  address: string
}) {
  const hasCoordinates = coordinates?.lat !== null && coordinates?.lng !== null
  const selected = source ?? (
    cadastralReference ? 'cadastral_reference' : hasCoordinates ? 'coordinates' : address ? 'address' : null
  )
  if (selected === 'cadastral_reference') {
    return cadastralReference ? { cadastralReference } : null
  }
  if (selected === 'coordinates') {
    return hasCoordinates ? { coordinates: { lat: coordinates!.lat!, lng: coordinates!.lng! } } : null
  }
  return selected === 'address' && address ? { address } : null
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
  const rawRefCatastral = formText(formData, 'refCatastral')
  const refCatastral = normalizeCadastralReference(rawRefCatastral)
  const address = formText(formData, 'address')
  const coordinates = coordinatesFromForm(formData)
  const inputSource = territorialInputSource(formData)
  const resolutionInput = resolutionInputFromForm({
    source: inputSource,
    cadastralReference: refCatastral,
    coordinates,
    address,
  })
  const planeamiento = formText(formData, 'planeamiento')
  const urbanPlanningZone = formText(formData, 'urbanPlanningZone')
  const landClassRaw = formText(formData, 'landClass')
  const landClass = LAND_CLASS_OPTIONS.some((option) => option.value === landClassRaw)
    ? landClassRaw as (typeof LAND_CLASS_OPTIONS)[number]['value']
    : null
  const classificationCandidateId = formText(formData, 'classificationCandidateId')
  const classificationSelectionReason = formText(formData, 'classificationSelectionReason')
  const actionTypeRaw = formText(formData, 'actionType')
  const actionType = actionTypeRaw || null
  const notes = formText(formData, 'notes')
  const initialContextAcceptance = getInitialContextAcceptance(formData)

  if ((!inputSource || inputSource === 'cadastral_reference') && rawRefCatastral && !refCatastral) {
    return creationError('La referencia catastral debe tener 14, 18 o 20 caracteres alfanuméricos.', 'refCatastral')
  }
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
  if (!resolutionInput && !urbanPlanningZone) {
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
  if (!preflight && resolutionInput) {
    try {
      preflight = summarizeSmartCaseDetection(
        await engine.detectStateless(resolutionInput)
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
  if (planeamiento && planeamiento !== preflight?.detected.planeamiento) {
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
  if (!cached && preflight && !preflight.detected.planeamiento && planeamiento) {
    return creationError(
      'El planeamiento anterior no ha podido verificarse en la nueva consulta. Selecciónelo de nuevo o déjelo pendiente.',
      'planeamiento'
    )
  }
  if (
    !cached &&
    preflight &&
    !preflight.result.planning.classificationResolution &&
    ((!preflight.detected.landClass && landClass) ||
      (!preflight.detected.urbanPlanningZone && urbanPlanningZone))
  ) {
    return creationError(
      'La clasificación o el ámbito anteriores no han podido verificarse en la nueva consulta. Revise la selección.',
      'landClass'
    )
  }

  const classificationResolution = preflight?.result.planning.classificationResolution
  const selectedCandidate = classificationResolution?.candidates.find(
    (candidate) => candidate.id === classificationCandidateId
  )
  if (classificationCandidateId && !selectedCandidate) {
    return creationError(
      'La evidencia de clasificación seleccionada ya no pertenece al análisis actual. Actualice la detección.',
      'landClass'
    )
  }
  const automaticLandClass = preflight?.detected.landClass ?? null
  const automaticZone = preflight?.detected.urbanPlanningZone ?? ''
  const manualClassificationSelection = Boolean(
    classificationResolution &&
      ((landClass && landClass !== automaticLandClass) ||
        (urbanPlanningZone && urbanPlanningZone !== automaticZone) ||
        classificationResolution.status !== 'clear')
  )
  if (
    manualClassificationSelection &&
    (landClass || urbanPlanningZone) &&
    !classificationSelectionReason
  ) {
    return creationError(
      'Indique brevemente el criterio utilizado para la selección manual de clasificación o ámbito.',
      'landClass'
    )
  }

  const canonical = preflight?.detected
  const canonicalCoordinates =
    canonical?.lat !== undefined && canonical.lng !== undefined
      ? { lat: canonical.lat, lng: canonical.lng }
      : coordinates
  const canonicalProvinceId = canonical?.provinceId ?? provinceId
  const canonicalMunicipalityId = canonical?.municipalityId ?? municipalityId
  const canonicalReference = canonical?.cadastralReference ?? refCatastral
  const canonicalAddress = canonical?.address ?? address

  let newExpedienteId: string
  try {
    const [newExpediente] = await db.insert(expedientes).values({
      orgId: membership.orgId,
      name,
      province: canonicalProvinceId,
      municipio: canonicalMunicipalityId,
      address: canonicalAddress || null,
      refCatastral: canonicalReference ?? null,
      lat: canonicalCoordinates.lat,
      lng: canonicalCoordinates.lng,
      location: canonicalCoordinates.lat !== null && canonicalCoordinates.lng !== null
        ? [canonicalCoordinates.lng, canonicalCoordinates.lat]
        : null,
      locationSource: canonical?.locationSource ?? (canonicalCoordinates.lat !== null ? 'coordinates' : canonicalAddress ? 'address' : 'manual'),
      urbanPlanningZone: urbanPlanningZone || null,
      landClass,
      actionType: actionType as typeof expedientes.$inferInsert.actionType,
      notes: notes || null,
      planeamiento: preflight ? preflight.detected.planeamiento ?? null : planeamiento || null,
      contextoValidadoPorTecnico: initialContextAcceptance.technicallyReviewed,
      status: 'active',
    }).returning({ id: expedientes.id })
    newExpedienteId = newExpediente.id

    let territorialContextPending = false
    try {
      if (preflight) {
        const resultForPersistence = classificationResolution
          ? {
              ...preflight.result,
              planning: {
                ...preflight.result.planning,
                classificationResolution: {
                  ...classificationResolution,
                  finalSelection:
                    manualClassificationSelection && (landClass || urbanPlanningZone)
                      ? {
                          origin: 'manual' as const,
                          candidateId: selectedCandidate?.id,
                          classificationCode: selectedCandidate?.classification.code,
                          categoryCode: selectedCandidate?.classification.categoryCode,
                          operationalValue: landClass ?? undefined,
                          areaNames: urbanPlanningZone ? [urbanPlanningZone] : [],
                          reason: classificationSelectionReason,
                          selectedAt: new Date().toISOString(),
                          selectedBy: userId,
                          technicianValidated: false,
                          resolutionFingerprint:
                            formText(formData, 'preflightDetectionId') || undefined,
                        }
                      : classificationResolution.automaticSelection,
                },
              },
            }
          : preflight.result
        if (!await engine.persistAuthorizedDetection(newExpedienteId, userId, resultForPersistence)) {
          throw new Error('territorial_context_not_persisted')
        }
      } else {
        if (!await engine.detectContext(newExpedienteId, userId)) {
          throw new Error('territorial_context_not_persisted')
        }
      }
    } catch (error) {
      territorialContextPending = true
      console.error({
        event: 'territorial_context_persistence_failed',
        expedienteId: newExpedienteId,
        errorType: error instanceof Error ? error.name : 'unknown',
      })
      try {
        await db
          .update(expedientes)
          .set({ status: 'territorial_context_pending' })
          .where(eq(expedientes.id, newExpedienteId))
      } catch (statusError) {
        console.error({
          event: 'territorial_context_pending_status_failed',
          expedienteId: newExpedienteId,
          errorType: statusError instanceof Error ? statusError.name : 'unknown',
        })
      }
    }

    if (territorialContextPending) {
      revalidatePath(`/expedientes/${newExpedienteId}`)
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

  const rawRefCatastral = formText(formData, 'refCatastral')
  const refCatastral = normalizeCadastralReference(rawRefCatastral)
  const coordinates = coordinatesFromForm(formData)
  const address = formText(formData, 'address')
  const inputSource = territorialInputSource(formData)
  const resolutionInput = resolutionInputFromForm({
    source: inputSource,
    cadastralReference: refCatastral,
    coordinates,
    address,
  })
  if ((!inputSource || inputSource === 'cadastral_reference') && rawRefCatastral && !refCatastral) {
    return { error: 'La referencia catastral debe tener 14, 18 o 20 caracteres alfanuméricos.' }
  }
  if (!resolutionInput) {
    return { error: 'Introduzca una referencia catastral válida, las dos coordenadas o una dirección.' }
  }

  try {
    const engine = new ContextDetectionEngine()
    const detection = summarizeSmartCaseDetection(
      await engine.detectStateless(resolutionInput)
    )
    const detectionId = storePreflightDetection(userId, detection)
    const clientDetection = {
      detected: detection.detected,
      progress: detection.progress,
      sourceChecks: detection.sourceChecks,
      affects: detection.affects,
      ...(detection.classificationResolution
        ? { classificationResolution: detection.classificationResolution }
        : {}),
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
