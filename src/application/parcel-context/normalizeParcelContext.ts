import { allMunicipalities, getMunicipalityNameById, getProvinceNameById } from '@/shared/territory'
import type {
  NormalizedParcelContext,
  ParcelContextField,
  ParcelContextSource,
  ParcelContextVerification,
  ParcelCoordinates,
} from '@/domain/parcel-context/types'

export interface ParcelExpedienteInput {
  refCatastral?: string | null
  address?: string | null
  lat?: number | null
  lng?: number | null
  municipio?: string | null
  province?: string | null
  landClass?: string | null
  urbanPlanningZone?: string | null
  planeamiento?: string | null
  contextoValidadoPorTecnico?: boolean | null
}

export interface DetectedParcelInput {
  cadastralReference?: string | null
  parcelReference?: string | null
  provinceId?: string | null
  provinceName?: string | null
  municipalityId?: string | null
  municipalityName?: string | null
  address?: string | null
  lat?: number | null
  lng?: number | null
  landClass?: string | null
  qualification?: string | null
  planningArea?: string | null
  planningInstrument?: string | null
  planningStatus?: string | null
  locationSource?: 'catastro' | 'cartociudad' | null
  planningSource?: 'siotuga' | 'urbanbrain' | null
  planningApplicabilityStatus?: 'determined' | 'partial' | 'conflict' | 'not_determined' | null
  planningCanAnswerConcreteParameters?: boolean | null
  locationStatus?: 'confirmed' | 'probable' | 'ambiguous' | 'unresolved' | null
  locationConfidence?: 'high' | 'medium' | 'low' | null
  planningWarnings?: Array<{ code: string; message: string }> | null
  planningConflicts?: string[] | null
  affects?: {
    detected?: Array<{
      category: string
      name: string
      confidence?: 'high' | 'medium' | 'low'
    }>
  } | null
  manualContext?: {
    cadastralReference?: string | null
    municipality?: string | null
    address?: string | null
    coordinates?: ParcelCoordinates | null
    classification?: string | null
    category?: string | null
    area?: string | null
    ordinance?: string | null
    observations?: string | null
    provenance: 'manual'
    verification: 'unverified' | 'technician_validated'
    recordedAt: string
  } | null
  reliability?: {
    mode:
      | 'current_official'
      | 'partial_official'
      | 'previous_official'
      | 'manual_unverified'
      | 'technician_validated_manual'
      | 'unresolved'
    latestAttemptAt?: string | null
    officialContextResolvedAt?: string | null
    usingPreviousOfficialContext?: boolean | null
    sourceChecks?: Array<{ status: string; message: string }> | null
  } | null
}

export interface KnownConstraintInput {
  name: string
  source?: ParcelContextSource | string | null
  confidence?: number | null
  confirmed?: boolean
}

export interface BuildParcelContextInput {
  expediente: ParcelExpedienteInput
  detected?: DetectedParcelInput | null
  userMessages?: string[]
  constraints?: KnownConstraintInput[]
}

interface ConversationFacts {
  cadastralReference?: string
  address?: string
  coordinates?: ParcelCoordinates
  municipalityName?: string
  landClass?: string
  qualification?: string
  planningArea?: string
}

const LAND_CLASS_PATTERNS: Array<[RegExp, string]> = [
  [/urbano\s+no\s+consolidado/i, 'urbano_no_consolidado'],
  [/urbano\s+consolidado/i, 'urbano_consolidado'],
  [/urbanizable/i, 'urbanizable'],
  [/(?:r[uú]stico|no\s+urbanizable)/i, 'rustico_no_urbanizable'],
  [/n[uú]cleo\s+rural/i, 'nucleo_rural'],
]

export function normalizeComparable(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function normalizeCadastralReference(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return [14, 18, 20].includes(normalized.length) ? normalized : null
}

function field<T>(
  value: T,
  source: ParcelContextField<T>['source'],
  confidence: number,
  verification: ParcelContextVerification,
  evidence?: string
): ParcelContextField<T> {
  return { value, source, confidence, verification, evidence }
}

function validCoordinates(lat: number | null | undefined, lng: number | null | undefined) {
  return (
    typeof lat === 'number' &&
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    typeof lng === 'number' &&
    Number.isFinite(lng) &&
    lng >= -180 &&
    lng <= 180
  )
}

function extractConversationFacts(messages: string[]): ConversationFacts {
  const facts: ConversationFacts = {}

  for (const original of messages) {
    const statements = original.split(/(?<=[.!?])\s+|\n+/)
    for (const statement of statements) {
      const message = statement.trim()
      if (!message || message.includes('?')) continue

      const rcMatch = message
        .toUpperCase()
        .match(
          /(?:referencia\s+catastral|ref\.?\s*catastral|rc)\s*(?:es|:)?\s*([A-Z0-9\s-]{14,24})/i
        )
      const rc = normalizeCadastralReference(rcMatch?.[1])
      if (rc) facts.cadastralReference = rc

      const coordinateMatch = message.match(
        /coordenadas?\s*(?:son|es|:)?\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)/i
      )
      if (coordinateMatch) {
        const lat = Number(coordinateMatch[1].replace(',', '.'))
        const lng = Number(coordinateMatch[2].replace(',', '.'))
        if (validCoordinates(lat, lng)) facts.coordinates = { lat, lng }
      }

      const municipalityMatch = message.match(
        /(?:municipio|concello)\s*(?:es|:|confirmado(?:\s+es)?)\s*([\p{L}\s-]{2,80})/iu
      )
      if (municipalityMatch) {
        const candidate = municipalityMatch[1].trim().replace(/[.,;].*$/, '')
        const known = allMunicipalities.find(
          (municipality) =>
            normalizeComparable(municipality.name) === normalizeComparable(candidate)
        )
        if (known) facts.municipalityName = known.name
      }

      const addressMatch = message.match(
        /direcci[oó]n\s*(?:es|:|confirmada(?:\s+es)?)\s*([^.;\n]{5,160})/i
      )
      if (addressMatch) facts.address = addressMatch[1].trim()

      const landClassStatement = message.match(
        /(?:clasificaci[oó]n|clase\s+de\s+suelo)\s*(?:es|:|confirmada(?:\s+es)?)\s*([^.;\n]{3,80})/i
      )
      if (landClassStatement) {
        const landClass = LAND_CLASS_PATTERNS.find(([pattern]) =>
          pattern.test(landClassStatement[1])
        )
        if (landClass) facts.landClass = landClass[1]
      }

      const zoningMatch = message.match(
        /(?:calificaci[oó]n|ordenanza)\s*(?:es|:|confirmada(?:\s+es)?)\s*([\p{L}0-9][\p{L}0-9 ._/-]{0,60})/iu
      )
      if (zoningMatch) facts.qualification = zoningMatch[1].trim().replace(/[.,;].*$/, '')

      const areaMatch = message.match(
        /(?:[aá]mbito|sector|ficha)\s*(?:es|:|confirmad[oa](?:\s+es)?)\s*([\p{L}0-9][\p{L}0-9 ._/-]{0,60})/iu
      )
      if (areaMatch) facts.planningArea = areaMatch[1].trim().replace(/[.,;].*$/, '')
    }
  }

  return facts
}

function addConflict(
  context: NormalizedParcelContext,
  fieldName: string,
  first: string,
  second: string,
  reason: string
) {
  if (normalizeComparable(first) === normalizeComparable(second)) return
  context.conflicts.push({ field: fieldName, values: [first, second], reason })
}

export function buildNormalizedParcelContext(
  input: BuildParcelContextInput
): NormalizedParcelContext {
  const { detected, constraints = [] } = input
  const manualWithoutMatchingOfficial = Boolean(
    detected?.manualContext && !detected.reliability?.usingPreviousOfficialContext
  )
  const expediente: ParcelExpedienteInput = manualWithoutMatchingOfficial
    ? { contextoValidadoPorTecnico: false }
    : input.expediente
  const conversation = extractConversationFacts(input.userMessages ?? [])
  const technicallyValidated = Boolean(expediente.contextoValidadoPorTecnico)
  const expedienteVerification: ParcelContextVerification = technicallyValidated
    ? 'confirmed'
    : 'unverified'
  const expedienteConfidence = technicallyValidated ? 0.98 : 0.78
  const detectedLocationSource = detected?.locationSource ?? 'catastro'
  const detectedLocationConfidence =
    detected?.locationConfidence === 'high'
      ? 0.95
      : detected?.locationConfidence === 'medium'
        ? 0.78
        : detectedLocationSource === 'catastro'
          ? 0.82
          : 0.68
  const hasConfirmedOfficialLocation = Boolean(
    detectedLocationSource === 'catastro' &&
      detected?.locationStatus === 'confirmed' &&
      detected?.locationConfidence === 'high'
  )
  const detectedLocationVerification: ParcelContextVerification =
    hasConfirmedOfficialLocation ? 'confirmed' : 'inferred'

  const context: NormalizedParcelContext = {
    canAnswerConcreteParameters: detected?.planningCanAnswerConcreteParameters === true,
    knownConstraints: [],
    conflicts: [],
    pendingValidation: [],
    reliability: detected?.reliability
      ? {
          mode: detected.reliability.mode,
          latestAttemptAt: detected.reliability.latestAttemptAt ?? undefined,
          officialContextResolvedAt:
            detected.reliability.officialContextResolvedAt ?? undefined,
          usingPreviousOfficialContext:
            detected.reliability.usingPreviousOfficialContext ?? false,
          sourceIssues:
            detected.reliability.sourceChecks
              ?.filter((check) =>
                ['partial', 'timeout', 'unavailable', 'malformed'].includes(check.status)
              )
              .map((check) => check.message) ?? [],
        }
      : undefined,
  }

  const detectedRc = normalizeCadastralReference(detected?.cadastralReference)
  const expedienteRc = normalizeCadastralReference(expediente.refCatastral)
  const conversationRc = conversation.cadastralReference
  if (detectedRc && hasConfirmedOfficialLocation) {
    context.cadastralReference = field(detectedRc, 'catastro', 0.98, 'confirmed')
  } else if (expedienteRc) {
    context.cadastralReference = field(
      expedienteRc,
      'expediente',
      expedienteConfidence,
      expedienteVerification
    )
  } else if (conversationRc) {
    context.cadastralReference = field(conversationRc, 'conversation', 0.72, 'unverified')
  }
  if (expedienteRc && conversationRc) {
    addConflict(
      context,
      'cadastralReference',
      expedienteRc,
      conversationRc,
      'La conversación y el expediente indican referencias distintas.'
    )
  }
  if (detectedRc && expedienteRc) {
    addConflict(
      context,
      'cadastralReference',
      detectedRc,
      expedienteRc,
      'Catastro y el expediente indican referencias catastrales distintas.'
    )
  }

  if (expediente.address?.trim()) {
    context.address = field(
      expediente.address.trim(),
      'expediente',
      expedienteConfidence,
      expedienteVerification
    )
  } else if (detected?.address?.trim()) {
    context.address = field(
      detected.address.trim(),
      detectedLocationSource,
      detectedLocationConfidence,
      detectedLocationVerification
    )
  } else if (conversation.address) {
    context.address = field(conversation.address, 'conversation', 0.65, 'unverified')
  }
  if (expediente.address?.trim() && detected?.address?.trim()) {
    addConflict(
      context,
      'address',
      expediente.address.trim(),
      detected.address.trim(),
      'Catastro y el expediente indican direcciones distintas.'
    )
  }
  if (expediente.address?.trim() && conversation.address) {
    addConflict(
      context,
      'address',
      expediente.address.trim(),
      conversation.address,
      'La conversación y el expediente indican direcciones distintas.'
    )
  }

  if (validCoordinates(expediente.lat, expediente.lng)) {
    context.coordinates = field(
      { lat: expediente.lat!, lng: expediente.lng! },
      'expediente',
      expedienteConfidence,
      expedienteVerification
    )
  } else if (detected && validCoordinates(detected.lat, detected.lng)) {
    context.coordinates = field(
      { lat: detected.lat!, lng: detected.lng! },
      detectedLocationSource,
      detectedLocationConfidence,
      detectedLocationVerification
    )
  } else if (conversation.coordinates) {
    context.coordinates = field(conversation.coordinates, 'conversation', 0.7, 'unverified')
  }
  if (
    validCoordinates(expediente.lat, expediente.lng) &&
    detected &&
    validCoordinates(detected.lat, detected.lng) &&
    (Math.abs(expediente.lat! - detected.lat!) > 0.0003 ||
      Math.abs(expediente.lng! - detected.lng!) > 0.0003)
  ) {
    context.conflicts.push({
      field: 'coordinates',
      values: [`${expediente.lat}, ${expediente.lng}`, `${detected.lat}, ${detected.lng}`],
      reason:
        'La detección territorial y el expediente indican coordenadas materialmente distintas.',
    })
  }

  const municipalityId = expediente.municipio?.trim() || undefined
  const municipalityName = municipalityId ? getMunicipalityNameById(municipalityId) : undefined
  const knownMunicipality = municipalityId
    ? allMunicipalities.find((municipality) => municipality.id === municipalityId)
    : undefined
  if (detected?.municipalityName?.trim() && hasConfirmedOfficialLocation) {
    context.municipality = field(
      {
        id: detected.municipalityId ?? undefined,
        name: detected.municipalityName.trim(),
      },
      'catastro',
      detectedLocationConfidence,
      'confirmed'
    )
  } else if (municipalityName) {
    context.municipality = field(
      { id: municipalityId, name: municipalityName, ineCode: knownMunicipality?.ineCode },
      'expediente',
      Math.min(expedienteConfidence, 0.78),
      'unverified'
    )
  } else if (detected?.municipalityName?.trim()) {
    context.municipality = field(
      {
        id: detected.municipalityId ?? undefined,
        name: detected.municipalityName.trim(),
      },
      detectedLocationSource,
      detectedLocationSource === 'catastro' ? 0.95 : 0.78,
      detectedLocationVerification
    )
  } else if (conversation.municipalityName) {
    context.municipality = field(
      { name: conversation.municipalityName },
      'conversation',
      0.7,
      'unverified'
    )
  }

  if (municipalityName && detected?.municipalityName) {
    addConflict(
      context,
      'municipality',
      municipalityName,
      detected.municipalityName,
      'Catastro y el expediente indican municipios distintos.'
    )
  }
  if (municipalityName && conversation.municipalityName) {
    addConflict(
      context,
      'municipality',
      municipalityName,
      conversation.municipalityName,
      'La conversación y el expediente indican municipios distintos.'
    )
  }

  const provinceId = expediente.province?.trim() || undefined
  if (provinceId) {
    context.province = field(
      { id: provinceId, name: getProvinceNameById(provinceId) },
      'expediente',
      expedienteConfidence,
      expedienteVerification
    )
  } else if (detected?.provinceName?.trim()) {
    context.province = field(
      { id: detected.provinceId ?? undefined, name: detected.provinceName.trim() },
      detectedLocationSource,
      detectedLocationSource === 'catastro' ? 0.95 : 0.78,
      detectedLocationVerification
    )
  }
  if (provinceId && detected?.provinceName) {
    addConflict(
      context,
      'province',
      getProvinceNameById(provinceId),
      detected.provinceName,
      'La detección territorial y el expediente indican provincias distintas.'
    )
  }

  const hasOfficialPlanningClass = Boolean(
    detected?.landClass &&
      detected.planningSource === 'siotuga' &&
      detected.planningApplicabilityStatus !== 'conflict'
  )
  const landClass = hasOfficialPlanningClass
    ? detected?.landClass
    : expediente.landClass || detected?.landClass || conversation.landClass
  if (landClass && landClass !== 'desconocido') {
    const source = hasOfficialPlanningClass
      ? 'siotuga'
      : expediente.landClass
        ? 'expediente'
        : detected?.landClass
          ? (detected.planningSource ?? 'urbanbrain')
          : 'conversation'
    context.landClass = field(
      landClass,
      source,
      source === 'siotuga' ? 0.9 : expedienteConfidence,
      source === 'siotuga'
        ? 'confirmed'
        : source === 'expediente'
          ? expedienteVerification
          : 'unverified'
    )
  }
  if (expediente.landClass && detected?.landClass) {
    addConflict(
      context,
      'landClass',
      expediente.landClass,
      detected.landClass,
      'La detección territorial y el expediente indican clases de suelo distintas.'
    )
  }
  if (expediente.landClass && conversation.landClass) {
    addConflict(
      context,
      'landClass',
      expediente.landClass,
      conversation.landClass,
      'La conversación y el expediente indican clases de suelo distintas.'
    )
  }

  const qualification =
    expediente.urbanPlanningZone?.trim() ||
    detected?.qualification?.trim() ||
    conversation.qualification
  if (qualification) {
    const source = expediente.urbanPlanningZone
      ? 'expediente'
      : detected?.qualification
        ? (detected.planningSource ?? 'urbanbrain')
        : 'conversation'
    context.qualification = field(
      qualification,
      source,
      source === 'siotuga' ? 0.9 : expedienteConfidence,
      source === 'siotuga'
        ? 'confirmed'
        : source === 'expediente'
          ? expedienteVerification
          : 'unverified'
    )
  }
  if (expediente.urbanPlanningZone?.trim() && detected?.qualification?.trim()) {
    addConflict(
      context,
      'qualification',
      expediente.urbanPlanningZone.trim(),
      detected.qualification.trim(),
      'La detección territorial y el expediente indican ordenanzas o calificaciones distintas.'
    )
  }
  if (expediente.urbanPlanningZone?.trim() && conversation.qualification) {
    addConflict(
      context,
      'qualification',
      expediente.urbanPlanningZone.trim(),
      conversation.qualification,
      'La conversación y el expediente indican ordenanzas o calificaciones distintas.'
    )
  }

  const planningArea = detected?.planningArea?.trim() || conversation.planningArea
  if (planningArea) {
    context.planningArea = field(
      planningArea,
      detected?.planningArea ? (detected.planningSource ?? 'urbanbrain') : 'conversation',
      detected?.planningArea ? 0.9 : 0.7,
      detected?.planningArea ? 'confirmed' : 'unverified'
    )
  } else if (qualification && /(?:[aá]mbito|sector|ficha)/i.test(qualification)) {
    context.planningArea = field(
      qualification,
      context.qualification!.source,
      context.qualification!.confidence,
      context.qualification!.verification
    )
  }

  const hasOfficialPlanningInstrument = Boolean(
    detected?.planningInstrument?.trim() && detected.planningSource === 'siotuga'
  )
  const planningInstrument = hasOfficialPlanningInstrument
    ? detected?.planningInstrument?.trim()
    : expediente.planeamiento?.trim() || detected?.planningInstrument?.trim()
  if (planningInstrument) {
    const detectedPlanningSource = detected?.planningSource ?? 'urbanbrain'
    context.planningInstrument = field(
      planningInstrument,
      hasOfficialPlanningInstrument
        ? detectedPlanningSource
        : expediente.planeamiento
          ? 'expediente'
          : detectedPlanningSource,
      hasOfficialPlanningInstrument ? 0.9 : expediente.planeamiento ? expedienteConfidence : 0.9,
      hasOfficialPlanningInstrument
        ? 'confirmed'
        : expediente.planeamiento
          ? expedienteVerification
          : 'confirmed'
    )
  }
  if (expediente.planeamiento?.trim() && detected?.planningInstrument?.trim()) {
    addConflict(
      context,
      'planningInstrument',
      expediente.planeamiento.trim(),
      detected.planningInstrument.trim(),
      'La detección territorial y el expediente indican instrumentos de planeamiento distintos.'
    )
  }

  if (detected?.planningStatus?.trim()) {
    context.validity = field(
      detected.planningStatus.trim(),
      detected.planningSource ?? 'urbanbrain',
      0.85,
      'confirmed'
    )
  } else if (technicallyValidated && context.planningInstrument) {
    context.validity = field(
      'vigencia confirmada por técnico',
      'expediente',
      0.95,
      'confirmed',
      'contexto_validado_por_tecnico'
    )
  }

  context.knownConstraints = constraints.map((constraint) =>
    field(
      constraint.name,
      [
        'expediente',
        'catastro',
        'cartociudad',
        'siotuga',
        'ideg',
        'urbanbrain',
        'conversation',
        'territory_catalogue',
        'manual',
      ].includes(constraint.source ?? '')
        ? (constraint.source as ParcelContextSource)
        : 'expediente',
      constraint.confidence ?? 0.7,
      constraint.confirmed ? 'confirmed' : 'unverified',
      constraint.source ?? undefined
    )
  )

  const manual = detected?.manualContext
  const manualVerification: ParcelContextVerification =
    manual?.verification === 'technician_validated' ? 'confirmed' : 'unverified'
  const manualConfidence = manual?.verification === 'technician_validated' ? 0.85 : 0.55
  const manualRc = normalizeCadastralReference(manual?.cadastralReference)
  if (manualRc && context.cadastralReference) {
    addConflict(
      context,
      'cadastralReference',
      context.cadastralReference.value,
      manualRc,
      'El dato manual no coincide con la referencia del contexto oficial conservado.'
    )
  }
  if (manual?.municipality?.trim() && context.municipality) {
    addConflict(
      context,
      'municipality',
      context.municipality.value.name,
      manual.municipality.trim(),
      'El municipio manual no coincide con el contexto oficial conservado.'
    )
  }
  if (manual?.classification?.trim() && context.landClass) {
    addConflict(
      context,
      'landClass',
      context.landClass.value,
      manual.classification.trim(),
      'La clasificacion manual no coincide con el contexto oficial conservado.'
    )
  }
  if (manual?.ordinance?.trim() && context.qualification) {
    addConflict(
      context,
      'qualification',
      context.qualification.value,
      manual.ordinance.trim(),
      'La ordenanza manual no coincide con el contexto oficial conservado.'
    )
  }
  if (manual?.area?.trim() && context.planningArea) {
    addConflict(
      context,
      'planningArea',
      context.planningArea.value,
      manual.area.trim(),
      'El ambito manual no coincide con el contexto oficial conservado.'
    )
  }
  if (!context.cadastralReference && manualRc) {
    context.cadastralReference = field(
      manualRc,
      'manual',
      manualConfidence,
      manualVerification,
      manual?.recordedAt
    )
  }
  if (!context.address && manual?.address?.trim()) {
    context.address = field(
      manual.address.trim(),
      'manual',
      manualConfidence,
      manualVerification,
      manual.recordedAt
    )
  }
  if (!context.coordinates && manual?.coordinates) {
    context.coordinates = field(
      manual.coordinates,
      'manual',
      manualConfidence,
      manualVerification,
      manual.recordedAt
    )
  }
  if (!context.municipality && manual?.municipality?.trim()) {
    context.municipality = field(
      { name: manual.municipality.trim() },
      'manual',
      manualConfidence,
      manualVerification,
      manual.recordedAt
    )
  }
  if (!context.landClass && manual?.classification?.trim()) {
    context.landClass = field(
      manual.category?.trim()
        ? `${manual.classification.trim()} (${manual.category.trim()})`
        : manual.classification.trim(),
      'manual',
      manualConfidence,
      manualVerification,
      manual.recordedAt
    )
  }
  if (!context.qualification && manual?.ordinance?.trim()) {
    context.qualification = field(
      manual.ordinance.trim(),
      'manual',
      manualConfidence,
      manualVerification,
      manual.recordedAt
    )
  }
  if (!context.planningArea && manual?.area?.trim()) {
    context.planningArea = field(
      manual.area.trim(),
      'manual',
      manualConfidence,
      manualVerification,
      manual.recordedAt
    )
  }
  if (manual?.observations?.trim()) {
    context.technicalNotes = field(
      manual.observations.trim(),
      'manual',
      manualConfidence,
      manualVerification,
      manual.recordedAt
    )
  }
  if (manual?.verification === 'unverified') {
    context.canAnswerConcreteParameters = false
    context.pendingValidation.push(
      'El contexto incluye datos manuales no verificados; no pueden habilitar parametros urbanisticos concretos.'
    )
  }
  if (context.reliability?.usingPreviousOfficialContext) {
    context.pendingValidation.push(
      `Se utiliza el ultimo contexto oficial valido de ${context.reliability.officialContextResolvedAt ?? 'fecha no disponible'} porque el intento mas reciente no pudo completarse.`
    )
  }
  for (const issue of context.reliability?.sourceIssues ?? []) {
    if (!context.pendingValidation.includes(issue)) context.pendingValidation.push(issue)
  }

  if (!context.cadastralReference && !context.address && !context.coordinates) {
    context.pendingValidation.push(
      'Falta identificar la parcela mediante referencia catastral, dirección o coordenadas.'
    )
  }
  if (!context.municipality) {
    context.pendingValidation.push('Falta confirmar el municipio de la parcela.')
  }
  if (!context.landClass) {
    context.pendingValidation.push('Falta confirmar la clasificación del suelo.')
  }
  if (!context.qualification && !context.planningArea) {
    context.pendingValidation.push(
      'Falta confirmar la calificación, ordenanza, ámbito o ficha aplicable.'
    )
  }
  if (!context.planningInstrument) {
    context.pendingValidation.push('Falta identificar el instrumento de planeamiento vigente.')
  }
  if (!context.validity) {
    context.pendingValidation.push('Falta verificar la vigencia del instrumento aplicable.')
  }
  if (!context.canAnswerConcreteParameters) {
    context.pendingValidation.push(
      'El resolver territorial no ha confirmado un régimen inequívoco para responder parámetros urbanísticos concretos.'
    )
  }

  for (const planningWarning of detected?.planningWarnings ?? []) {
    if (!context.pendingValidation.includes(planningWarning.message)) {
      context.pendingValidation.push(planningWarning.message)
    }
  }
  for (const planningConflict of detected?.planningConflicts ?? []) {
    context.conflicts.push({
      field: 'planning',
      values: [],
      reason: planningConflict,
    })
  }

  return context
}

export function trustedMunicipalityFilter(context: NormalizedParcelContext): string | null {
  const municipality = context.municipality
  if (
    municipality?.source !== 'catastro' ||
    municipality.verification !== 'confirmed' ||
    municipality.confidence < 0.9
  ) {
    return null
  }
  return municipality.value.name
}
