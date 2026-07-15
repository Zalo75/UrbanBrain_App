import type {
  ManualTerritorialContext,
  OfficialSourceCheck,
  ResolveParcelLocationInput,
  TerritorialCoordinates,
  TerritorialResolution,
} from '@/domain/territorial-resolver/types'

const TRANSIENT_STATUSES = new Set(['timeout', 'unavailable', 'malformed', 'partial'])

function comparable(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function normalizeReference(value: string | null | undefined) {
  return value?.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 14) || undefined
}

function distanceMetres(a: TerritorialCoordinates, b: TerritorialCoordinates) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180
  const dLat = radians(b.lat - a.lat)
  const dLng = radians(b.lng - a.lng)
  const lat1 = radians(a.lat)
  const lat2 = radians(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

export function allSourceChecks(result: TerritorialResolution): OfficialSourceCheck[] {
  return [
    ...(result.sourceChecks ?? []),
    ...(result.planning.sourceChecks ?? []),
    ...(result.affects.sourceChecks ?? []),
  ]
}

export function hasTransientOfficialFailure(result: TerritorialResolution) {
  return allSourceChecks(result).some((check) => TRANSIENT_STATUSES.has(check.status))
}

export function isUsableOfficialContext(result: TerritorialResolution | undefined): boolean {
  return Boolean(
    result &&
      (result.status === 'confirmed' || result.status === 'probable') &&
      result.evidence.some((evidence) => evidence.source === 'catastro' || evidence.source === 'cartociudad')
  )
}

export function effectiveOfficialContext(value: unknown): TerritorialResolution | undefined {
  if (!value || typeof value !== 'object') return undefined
  const result = value as TerritorialResolution
  const effective = result.continuity?.effectiveOfficialContext
  if (
    result.continuity?.usingPreviousOfficialContext &&
    effective &&
    isUsableOfficialContext(effective)
  ) {
    return { ...effective, continuity: undefined }
  }
  if (isUsableOfficialContext(result)) {
    return { ...result, continuity: undefined }
  }
  if (effective && isUsableOfficialContext(effective)) {
    return { ...effective, continuity: undefined }
  }
  const lastOfficial = result.continuity?.lastOfficialContext
  if (lastOfficial && isUsableOfficialContext(lastOfficial)) {
    return { ...lastOfficial, continuity: undefined }
  }
  return undefined
}

export function officialContextForUse(result: TerritorialResolution) {
  const effective = result.continuity?.effectiveOfficialContext
  if (effective && isUsableOfficialContext(effective)) return effective
  return isUsableOfficialContext(result) ? result : undefined
}

export function targetsSameParcel(
  input: ResolveParcelLocationInput,
  previous: TerritorialResolution
) {
  const inputReference = normalizeReference(input.cadastralReference)
  const previousReference = normalizeReference(previous.cadastralReference)
  if (inputReference) return Boolean(previousReference && inputReference === previousReference)

  if (input.coordinates) {
    return Boolean(previous.coordinates && distanceMetres(input.coordinates, previous.coordinates) <= 25)
  }

  if (input.address?.trim()) {
    return Boolean(
      previous.normalizedAddress &&
        comparable(input.address) === comparable(previous.normalizedAddress)
    )
  }
  return false
}

export function attachContinuity(
  current: TerritorialResolution,
  input: ResolveParcelLocationInput,
  previousRaw: unknown,
  manualContext?: ManualTerritorialContext
) {
  const previous = effectiveOfficialContext(previousRaw)
  const sameParcel = Boolean(previous && targetsSameParcel(input, previous))
  const useCurrent = isUsableOfficialContext(current)
  const usePrevious = Boolean(
    !useCurrent && previous && sameParcel && hasTransientOfficialFailure(current)
  )
  let effective = usePrevious ? previous : undefined
  let usesPreviousComponent = usePrevious

  if (useCurrent && previous && sameParcel) {
    const transient = (checks: OfficialSourceCheck[] | undefined) =>
      checks?.some((check) => TRANSIENT_STATUSES.has(check.status)) ?? false
    const locationIncomplete = transient(current.sourceChecks)
    const planningIncomplete = transient(current.planning.sourceChecks)
    const affectsIncomplete = transient(current.affects.sourceChecks)

    if (locationIncomplete || planningIncomplete || affectsIncomplete) {
      usesPreviousComponent = true
      effective = {
        ...current,
        cadastralReference:
          current.cadastralReference ?? previous.cadastralReference,
        normalizedAddress: current.normalizedAddress ?? previous.normalizedAddress,
        municipality: current.municipality ?? previous.municipality,
        municipalityCode: current.municipalityCode ?? previous.municipalityCode,
        province: current.province ?? previous.province,
        provinceCode: current.provinceCode ?? previous.provinceCode,
        coordinates: current.coordinates ?? previous.coordinates,
        parcelGeometry: current.parcelGeometry ?? previous.parcelGeometry,
        planning: planningIncomplete ? previous.planning : current.planning,
        affects: affectsIncomplete ? previous.affects : current.affects,
        evidence: [...current.evidence, ...previous.evidence],
        resolvedAt: previous.resolvedAt,
        continuity: undefined,
      }
    }
  }

  current.continuity = {
    lastOfficialContext: previous,
    effectiveOfficialContext: effective,
    usingPreviousOfficialContext: usesPreviousComponent,
    sameParcelAsPrevious: sameParcel,
    manualContext,
  }
  return current
}

export function createManualAttempt(
  input: ResolveParcelLocationInput,
  manualContext: ManualTerritorialContext,
  previousRaw: unknown
): TerritorialResolution {
  const result: TerritorialResolution = {
    status: 'unresolved',
    confidence: 'low',
    inputMethod: input.cadastralReference
      ? 'cadastral_reference'
      : input.coordinates
        ? 'coordinates'
        : input.address
          ? 'address'
          : 'none',
    cadastralReference: input.cadastralReference ?? undefined,
    normalizedAddress: input.address ?? undefined,
    municipality: manualContext.municipality,
    coordinates: input.coordinates ?? undefined,
    candidates: [],
    evidence: [],
    sourceChecks: [],
    warnings: [
      {
        code: 'manual_context_pending_validation',
        message:
          manualContext.verification === 'technician_validated'
            ? 'Los datos han sido validados por un tecnico, pero no proceden de una comprobacion oficial automatica.'
            : 'Los datos manuales quedan pendientes de validacion tecnica y oficial.',
      },
    ],
    conflicts: [],
    planning: {
      status: 'not_determined',
      evidence: [],
      warnings: [],
      canAnswerConcreteParameters: false,
    },
    affects: {
      analysisGeometry: input.coordinates ? 'point' : 'none',
      detected: [],
      canRuleOutUndetectedAffects: false,
      warnings: [
        {
          code: 'manual_affects_not_checked',
          message: 'Las afecciones oficiales no se han podido comprobar con los datos manuales.',
        },
      ],
    },
    resolvedAt: manualContext.recordedAt,
    attemptStartedAt: manualContext.recordedAt,
  }
  const attached = attachContinuity(result, input, previousRaw, manualContext)
  if (
    attached.continuity?.lastOfficialContext &&
    attached.continuity.sameParcelAsPrevious
  ) {
    attached.continuity.effectiveOfficialContext = attached.continuity.lastOfficialContext
    attached.continuity.usingPreviousOfficialContext = true
  }
  return attached
}
