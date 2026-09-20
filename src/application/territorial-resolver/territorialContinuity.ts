import type {
  ManualTerritorialContext,
  OfficialSourceCheck,
  ResolveParcelLocationInput,
  TerritorialCoordinates,
  TerritorialResolution,
} from '@/domain/territorial-resolver/types'
import { isPureAutomaticDetectedZoneContext } from './actionAreaSelection'

const TRANSIENT_STATUSES = new Set(['timeout', 'unavailable', 'malformed', 'partial'])

function comparable(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function planningContextIdentities(planning: TerritorialResolution['planning']) {
  return new Set(
    [
      planning.classification?.code,
      planning.classification?.categoryCode,
      planning.classification?.label,
      planning.classification?.categoryLabel,
      planning.urbanisticFacts?.classification.value?.code,
      planning.urbanisticFacts?.classification.value?.label,
      planning.urbanisticFacts?.category.value?.code,
      planning.urbanisticFacts?.category.value?.label,
    ]
      .filter((value): value is string => Boolean(value?.trim()))
      .map(comparable),
  )
}

function planningInstrumentIds(planning: TerritorialResolution['planning']) {
  return new Set(
    [
      ...(planning.applicableInstruments ?? []).map((instrument) => instrument.id),
      ...(planning.ordinanceCandidates ?? []).map((candidate) => candidate.instrumentId),
      ...(planning.contextualCandidates ?? []).map((candidate) => candidate.instrumentId),
    ].filter((value): value is string => Boolean(value?.trim())),
  )
}

function sameMunicipality(current: TerritorialResolution, previous: TerritorialResolution) {
  if (current.municipalityCode && previous.municipalityCode) {
    return current.municipalityCode === previous.municipalityCode
  }
  if (current.municipality && previous.municipality) {
    return comparable(current.municipality) === comparable(previous.municipality)
  }
  // A missing identifier is not evidence of a change. The parcel identity
  // guard still applies, and the absence is surfaced through the source check.
  return true
}

function samePlanningInstrument(
  current: TerritorialResolution['planning'],
  previous: TerritorialResolution['planning'],
) {
  const currentIds = planningInstrumentIds(current)
  const previousIds = planningInstrumentIds(previous)
  if (currentIds.size > 0 && previousIds.size > 0) {
    return [...currentIds].some((id) => previousIds.has(id))
  }
  if (current.instrument && previous.instrument) {
    return comparable(current.instrument) === comparable(previous.instrument)
  }
  return true
}

function planningEvidenceIsUseful(planning: TerritorialResolution['planning']) {
  return Boolean(
    (planning.ordinanceCandidates?.length ?? 0) > 0 ||
      (planning.contextualCandidates?.length ?? 0) > 0 ||
      planning.ordinanceResolution?.status === 'USER_CONFIRMED' ||
      planning.ordinanceResolution?.status === 'RESOLVED' ||
      planning.ordinanceResolution?.status === 'RESOLVED_WITH_PRECISION_WARNING' ||
      (planning.applicableInstruments?.length ?? 0) > 0 ||
      (planning.documents?.length ?? 0) > 0 ||
      Boolean(planning.classification) ||
      planning.evidence.length > 0 ||
      planning.status === 'determined',
  )
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
  return allSourceChecks(result).some((check) => TRANSIENT_STATUSES.has(check.status)) ||
    Boolean(result.planning.cartographicSourceChecks?.some(check => check.status === 'unavailable'))
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

/**
 * A recalculation may return the same detailed identities with a degraded
 * semantic label (for example a VLM classifying both a category and an
 * ordinance as `category`).  When that is the only change, retain the prior
 * detailed determination instead of replacing a useful result with an empty
 * candidate set.  A genuinely different set is left untouched so that real
 * contradictions are never hidden.
 */
function preservePriorDetailedCandidates(
  current: TerritorialResolution,
  previous: TerritorialResolution | undefined,
  sameParcel: boolean,
) {
  if (!sameParcel || !previous) return
  const currentInstrumentIds = new Set(
    (current.planning.applicableInstruments ?? []).map((instrument) => instrument.id).filter(Boolean),
  )
  const previousInstrumentIds = new Set(
    (previous.planning.applicableInstruments ?? []).map((instrument) => instrument.id).filter(Boolean),
  )
  if (
    currentInstrumentIds.size > 0 &&
    previousInstrumentIds.size > 0 &&
    ![...currentInstrumentIds].some((instrumentId) => previousInstrumentIds.has(instrumentId))
  ) return
  const previousCandidates = previous.planning.ordinanceCandidates ?? []
  const currentCandidates = current.planning.ordinanceCandidates ?? []
  const currentContextual = current.planning.contextualCandidates ?? []
  if (previousCandidates.length === 0 || currentCandidates.length > 0 || currentContextual.length === 0) return

  const previousIdentities = new Set(previousCandidates.map((candidate) => comparable(candidate.identity)))
  const semanticDowngrade = currentContextual.some((candidate) => previousIdentities.has(comparable(candidate.identity)))
  if (!semanticDowngrade) return
  const contextIdentities = planningContextIdentities(current.planning)
  const unexplainedContextual = currentContextual.some(
    (candidate) =>
      !previousIdentities.has(comparable(candidate.identity)) &&
      !contextIdentities.has(comparable(candidate.identity)),
  )
  if (unexplainedContextual) return

  const contextualByIdentity = new Map(
    [...(previous.planning.contextualCandidates ?? []), ...currentContextual]
      .map((candidate) => [comparable(candidate.identity), candidate] as const)
  )
  current.planning = {
    ...current.planning,
    ordinanceCandidates: previousCandidates,
    contextualCandidates: [...contextualByIdentity.values()],
    ordinanceResolutionStatus:
      previous.planning.ordinanceResolutionStatus ?? current.planning.ordinanceResolutionStatus,
    ordinanceResolution:
      previous.planning.ordinanceResolution ?? current.planning.ordinanceResolution,
  }
}

/**
 * Preserve the last useful planning result when an external zoning source
 * fails transiently. This runs before persistence, so the UI and the raw
 * detection never receive a destructive empty replacement. A normal empty
 * result (without a transient source check) intentionally does not enter this
 * path.
 */
function preservePriorPlanningAfterTransientFailure(
  current: TerritorialResolution,
  previous: TerritorialResolution | undefined,
  sameParcel: boolean,
) {
  if (!sameParcel || !previous || !sameMunicipality(current, previous)) return false
  if (!samePlanningInstrument(current.planning, previous.planning)) return false
  const planningFailed = Boolean(current.planning.sourceChecks?.some((check) =>
    TRANSIENT_STATUSES.has(check.status),
  ) || current.planning.cartographicSourceChecks?.some(check => check.status === 'unavailable'))
  if (!planningFailed || !planningEvidenceIsUseful(previous.planning)) return false

  const currentCandidates = current.planning.ordinanceCandidates ?? []
  const previousCandidates = previous.planning.ordinanceCandidates ?? []
  const currentContextual = current.planning.contextualCandidates ?? []
  const previousContextual = previous.planning.contextualCandidates ?? []
  // A non-empty current result is a valid fresh determination and therefore
  // outranks the previous one. Likewise, never overwrite a fresh user
  // confirmation with a stale automatic result.
  if (
    currentCandidates.length > 0 ||
    current.planning.ordinanceResolution?.status === 'USER_CONFIRMED'
  ) return false
  const contextualByIdentity = new Map(
    [...previousContextual, ...currentContextual]
      .map((candidate) => [comparable(candidate.identity), candidate] as const),
  )

  current.planning = {
    ...current.planning,
    status: 'partial',
    evidence: [...current.planning.evidence, ...previous.planning.evidence],
    warnings: [
      ...current.planning.warnings,
      ...previous.planning.warnings,
      {
        code: 'planning_previous_context_preserved',
        message:
          'La fuente de planeamiento no está disponible temporalmente; se conserva la última evidencia compatible.',
      },
    ],
    applicableInstruments:
      current.planning.applicableInstruments?.length
        ? current.planning.applicableInstruments
        : previous.planning.applicableInstruments,
    cataloguedInstruments:
      current.planning.cataloguedInstruments?.length
        ? current.planning.cataloguedInstruments
        : previous.planning.cataloguedInstruments,
    documents:
      current.planning.documents?.length ? current.planning.documents : previous.planning.documents,
    ordinanceCandidates: currentCandidates.length ? currentCandidates : previousCandidates,
    contextualCandidates: [...contextualByIdentity.values()],
    ordinanceResolutionStatus:
      previous.planning.ordinanceResolutionStatus ?? current.planning.ordinanceResolutionStatus,
    ordinanceResolution:
      previous.planning.ordinanceResolution ?? current.planning.ordinanceResolution,
    canAnswerConcreteParameters:
      current.planning.canAnswerConcreteParameters ?? previous.planning.canAnswerConcreteParameters,
  }
  return true
}

export function attachContinuity(
  current: TerritorialResolution,
  input: ResolveParcelLocationInput,
  previousRaw: unknown,
  manualContextArg?: ManualTerritorialContext
) {
  const previous = effectiveOfficialContext(previousRaw)
  const previousRawResult = previousRaw as TerritorialResolution | undefined
  const sameParcel = Boolean(previous && targetsSameParcel(input, previous))
  const preservedPlanning = preservePriorPlanningAfterTransientFailure(current, previous, sameParcel)
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
    const planningCanUsePrevious =
      planningIncomplete && sameMunicipality(current, previous) && samePlanningInstrument(current.planning, previous.planning)

    if (locationIncomplete || planningCanUsePrevious || affectsIncomplete) {
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
        planning: current.planning,
        affects: affectsIncomplete ? previous.affects : current.affects,
        evidence: [...current.evidence, ...previous.evidence],
        resolvedAt: previous.resolvedAt,
        continuity: undefined,
      }
    }
  }

  preservePriorDetailedCandidates(current, previous, sameParcel)

  let manualContext = manualContextArg ?? (sameParcel ? previousRawResult?.continuity?.manualContext : undefined)
  const currentPlanningHasTransientFailure = current.planning.sourceChecks?.some(
    (check) => TRANSIENT_STATUSES.has(check.status)
  ) ?? false
  if (
    manualContextArg === undefined &&
    useCurrent &&
    !currentPlanningHasTransientFailure &&
    isPureAutomaticDetectedZoneContext(current, manualContext)
  ) {
    manualContext = undefined
  }

  current.continuity = {
    lastOfficialContext: previous,
    effectiveOfficialContext: effective,
    usingPreviousOfficialContext: usesPreviousComponent || preservedPlanning,
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
