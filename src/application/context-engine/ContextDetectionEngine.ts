import { resolveParcelLocation } from '@/application/territorial-resolver/resolveParcelLocation'
import type { TerritorialDetectionSummary } from '@/application/parcel-context/normalizeParcelContext'
import type {
  ManualTerritorialContext,
  ResolveParcelLocationInput,
  TerritorialResolution,
} from '@/domain/territorial-resolver/types'
import {
  allSourceChecks,
  attachContinuity,
  createManualAttempt,
  officialContextForUse,
} from '@/application/territorial-resolver/territorialContinuity'
import { getEffectiveValue, createAutomaticDetermination } from '@/domain/territorial-resolver/determinations'
import type { ContextDeterminationState } from '@/domain/territorial-resolver/types'
import { db } from '@/infrastructure/db/client'
import { contextDetections, expedientes } from '@/infrastructure/db/schema'
import { and, eq } from 'drizzle-orm'
import { loadAuthorizedParcelInputs } from '@/infrastructure/db/parcelContextRepository'
import { CatastroOfficialAdapter } from '@/infrastructure/territorial-resolver/CatastroOfficialAdapter'
import { CartoCiudadOfficialAdapter } from '@/infrastructure/territorial-resolver/CartoCiudadOfficialAdapter'
import { DatabasePlanningAdapter } from '@/infrastructure/territorial-resolver/DatabasePlanningAdapter'
import { BetanzosPlanningAdapter } from '@/infrastructure/territorial-resolver/BetanzosPlanningAdapter'
import { SiotugaClassificationSourceAdapter } from '@/infrastructure/territorial-resolver/SiotugaClassificationAdapter'
import { MultiSourceClassificationResolver } from '@/application/territorial-resolver/multiSourceClassificationResolver'
import { IdegAffectAdapter } from '@/infrastructure/territorial-resolver/IdegAffectAdapter'
import {
  getMunicipalityByName,
  getProvinceById,
  getProvinceByMunicipalityIneCode,
  getProvinceByName,
} from '@/shared/territory'
import { territorialFieldConfirmations } from '@/application/territorial-resolver/fieldConfirmations'
import {
  applyManualAffectDecisions,
  applyManualFactDecisions,
} from '@/application/territorial-resolver/manualTerritorialContext'
import { assessClassificationResolution } from '@/domain/territorial-resolver/classificationDecision'
import { urbanisticFactsFromClassificationResolution } from '@/domain/territorial-resolver/urbanisticFacts'
import { applyActionAreaToUrbanisticFacts } from '@/application/territorial-resolver/actionAreaSelection'

type Resolver = (input: ResolveParcelLocationInput) => Promise<TerritorialResolution>

function canonicalLocationInput(input: ResolveParcelLocationInput): ResolveParcelLocationInput {
  if (input.cadastralReference) return { cadastralReference: input.cadastralReference }
  if (input.coordinates) return { coordinates: input.coordinates }
  if (input.address?.trim()) return { address: input.address.trim() }
  return {}
}

function officialResolver(): Resolver {
  const dependencies = {
    catastro: new CatastroOfficialAdapter(),
    geocoder: new CartoCiudadOfficialAdapter(),
    planning: new MultiSourceClassificationResolver(
      new BetanzosPlanningAdapter(new DatabasePlanningAdapter()),
      [{
        id: 'SIOTUGA WFS',
        source: 'siotuga',
        adapter: new SiotugaClassificationSourceAdapter(),
        requiredForAutomaticDecision: true,
      }]
    ),
    affects: new IdegAffectAdapter(),
  }
  return (input) => resolveParcelLocation(input, dependencies)
}

function detectionSummary(result: TerritorialResolution): TerritorialDetectionSummary {
  const effective = officialContextForUse(result)
  const classificationAssessment = assessClassificationResolution(
    effective?.planning.classificationResolution
  )
  const manual = result.continuity?.manualContext
  const actionArea = manual?.actionAreaSelection?.current
  const actionAreaCandidate = actionArea?.selectedCandidateId
    ? effective?.planning.classificationResolution?.candidates.find(
        (candidate) => candidate.id === actionArea.selectedCandidateId
      )
    : undefined
  const municipality = getMunicipalityByName(effective?.municipality ?? '')
  const province =
    getProvinceByMunicipalityIneCode(effective?.municipalityCode) ??
    (municipality ? getProvinceById(municipality.provinceId) : undefined) ??
    getProvinceByName(effective?.province ?? '')
  const automaticLandClass =
    effective?.planning.classification?.code === 'SU'
      ? 'urbano'
      : effective?.planning.classification?.code === 'SNR'
        ? 'nucleo_rural'
        : effective?.planning.classification?.code === 'SR'
          ? 'rustico'
          : undefined

  const automaticSource = effective?.planning.evidence.some(e => e.source === 'siotuga') ? 'siotuga' : 'urbanbrain'
  const automaticLandClassDet = automaticLandClass ? createAutomaticDetermination(automaticLandClass, automaticSource) : undefined
  const actionAreaLandClass = actionAreaCandidate?.kind === 'official_classification' ? (
    actionAreaCandidate.classification.code === 'SU'
      ? actionAreaCandidate.classification.categoryCode === 'SUSC' ||
        actionAreaCandidate.classification.categoryCode === 'SUNC'
        ? 'urbano_no_consolidado'
        : actionAreaCandidate.classification.categoryCode === 'SUC'
          ? 'urbano_consolidado'
          : 'urbano'
      : actionAreaCandidate.classification.code === 'SNR'
        ? 'nucleo_rural'
        : actionAreaCandidate.classification.code === 'SR'
          ? 'rustico'
          : undefined
  ) : undefined
  const actionAreaLandClassDetermination = actionAreaLandClass && actionArea
    ? {
        value: actionAreaLandClass,
        origin: 'technician_selection' as const,
        source: 'manual' as const,
        verification: actionArea.verification,
        recordedAt: actionArea.selectedAt,
        recordedBy: actionArea.selectedBy,
        validatedAt:
          actionArea.verification === 'technician_validated' ? actionArea.selectedAt : undefined,
        validatedBy:
          actionArea.verification === 'technician_validated' ? actionArea.selectedBy : undefined,
        previousAutomaticValue: automaticLandClass,
      }
    : undefined
  const classDet: ContextDeterminationState<string> = {
    automatic: automaticLandClassDet,
    technician: actionAreaLandClassDetermination ?? manual?.classificationDetermination?.technician
  }

  const landClass = getEffectiveValue(classDet, manual?.classification ?? automaticLandClass)
  const parcelAffects = effective?.affects ?? result.affects
  const automaticAffects = actionArea?.selectionType === 'detected_zone' && actionArea.affects
    ? actionArea.affects
    : parcelAffects
  const affectResolution = applyManualAffectDecisions(
    automaticAffects.detected,
    manual?.affectDecisions
  )
  const checks = allSourceChecks(result)
  const hasIncompleteSource = checks.some((check) =>
    ['partial', 'timeout', 'unavailable', 'malformed'].includes(check.status)
  )
  const reliabilityMode = manual
    ? manual.verification === 'technician_validated'
      ? 'technician_validated_manual'
      : 'manual_unverified'
    : result.continuity?.usingPreviousOfficialContext
      ? 'previous_official'
      : effective
        ? hasIncompleteSource
          ? 'partial_official'
          : 'current_official'
        : 'unresolved'
  const baseUrbanisticFacts =
    effective?.planning.urbanisticFacts ??
    (effective?.planning.classificationResolution
      ? urbanisticFactsFromClassificationResolution(effective.planning, result.resolvedAt)
      : undefined)
  const urbanisticFacts = baseUrbanisticFacts
    ? applyActionAreaToUrbanisticFacts(
        applyManualFactDecisions(baseUrbanisticFacts, manual).effective,
        effective,
        actionArea
      )
    : undefined

  return {
    cadastralReference: effective?.cadastralReference,
    parcelReference: effective?.parcelReference,
    provinceId: province?.id,
    provinceName: effective?.province,
    provinceCode: effective?.provinceCode,
    municipalityId: municipality?.id,
    municipalityName: effective?.municipality,
    municipalityCode: effective?.municipalityCode,
    address: effective?.normalizedAddress,
    lat: effective?.coordinates?.lat,
    lng: effective?.coordinates?.lng,
    parcelGeometry: effective?.parcelGeometry,
    locationStatus: effective?.status ?? result.status,
    locationConfidence: effective?.confidence ?? result.confidence,
    locationSource: effective?.evidence.some((item) => item.source === 'catastro')
      ? 'catastro'
      : effective?.evidence.some((item) => item.source === 'cartociudad')
        ? 'cartociudad'
        : undefined,
    planningInstrument: effective?.planning.instrument,
    planningStatus: effective?.planning.applicableInstruments?.some(
      (instrument) => instrument.status === 'current'
    )
      ? 'vigente'
      : effective?.planning.status === 'determined'
        ? 'vigente'
        : undefined,
    planningApplicabilityStatus:
      actionArea?.selectionType === 'detected_zone'
        ? actionArea.verification === 'technician_validated'
          ? 'determined'
          : 'partial'
        : effective?.planning.status ?? 'not_determined',
    planningCanAnswerConcreteParameters:
      effective?.planning.canAnswerConcreteParameters ?? false,
    classificationConfidenceLevel: classificationAssessment.level,
    classificationReason: classificationAssessment.reason,
    classificationSources: classificationAssessment.sources,
    classificationWarnings: classificationAssessment.warnings,
    urbanisticFacts,
    planningWarnings: effective?.planning.warnings ?? [],
    planningConflicts:
      actionArea?.selectionType === 'detected_zone'
        ? []
        : effective?.planning.conflicts ?? [],
    parcelPlanningConflicts: effective?.planning.conflicts ?? [],
    planningSource: effective?.planning.evidence.some((item) => item.source === 'siotuga')
      ? 'siotuga'
      : effective?.planning.status === 'determined'
        ? 'urbanbrain'
        : undefined,
    landClass,
    automaticLandClass,
    planningArea:
      actionArea?.selectionType === 'detected_zone'
        ? actionArea.planningZone
        : manual?.area ??
      (effective?.planning.status !== 'conflict' && effective?.planning.areas?.length === 1
        ? effective.planning.areas[0].name
        : undefined),
    qualification: manual?.ordinanceDetermination
      ? getEffectiveValue(manual.ordinanceDetermination, manual.ordinance)
      : manual?.ordinance,
    classificationDetermination: classDet,
    categoryDetermination: manual?.categoryDetermination,
    ordinanceDetermination: manual?.ordinanceDetermination,
    manualContext: manual,
    actionAreaSelection: manual?.actionAreaSelection,
    reliability: {
      mode: reliabilityMode,
      latestAttemptAt: result.attemptStartedAt ?? result.resolvedAt,
      officialContextResolvedAt: effective?.resolvedAt,
      usingPreviousOfficialContext: result.continuity?.usingPreviousOfficialContext ?? false,
      sourceChecks: checks,
    },
    warnings: [
      ...result.warnings,
      ...result.planning.warnings,
      ...result.affects.warnings,
      ...(effective && effective !== result ? effective.planning.warnings : []),
    ],
    conflicts: result.conflicts,
    affects: {
      ...automaticAffects,
      automatic: automaticAffects.detected,
      parcel: parcelAffects.detected,
      manualDecisions: manual?.affectDecisions ?? [],
      detected: affectResolution.effective,
    },
    resolvedAt: result.resolvedAt,
    fieldConfirmations: territorialFieldConfirmations(effective ?? result),
  }
}

export class ContextDetectionEngine {
  constructor(private readonly resolver: Resolver = officialResolver()) {}

  async detectContext(expedienteId: string, userId: string): Promise<TerritorialResolution | null> {
    const attemptStartedAt = new Date().toISOString()
    const authorized = await loadAuthorizedParcelInputs(expedienteId, userId)
    if (!authorized) return null

    return this.resolveAndPersist(expedienteId, authorized, {
      ...canonicalLocationInput({
        cadastralReference: authorized.expediente.refCatastral,
        coordinates:
          authorized.expediente.lat !== null && authorized.expediente.lng !== null
            ? { lat: authorized.expediente.lat!, lng: authorized.expediente.lng! }
            : undefined,
        address: authorized.expediente.address,
      }),
      declaredMunicipality: authorized.expediente.municipio,
    }, attemptStartedAt)
  }

  async detectContextFromInput(
    expedienteId: string,
    userId: string,
    input: ResolveParcelLocationInput,
    attemptStartedAt = new Date().toISOString()
  ): Promise<TerritorialResolution | null> {
    const authorized = await loadAuthorizedParcelInputs(expedienteId, userId)
    if (!authorized) return null
    return this.resolveAndPersist(expedienteId, authorized, {
      ...canonicalLocationInput(input),
      declaredMunicipality: authorized.expediente.municipio,
    }, attemptStartedAt)
  }

  /**
   * Persists a pre-creation resolution only after confirming that the caller may
   * write context for the newly-created expediente. This avoids repeating the
   * official queries already performed immediately before creation.
   */
  async persistAuthorizedDetection(
    expedienteId: string,
    userId: string,
    result: TerritorialResolution
  ): Promise<boolean> {
    const authorized = await loadAuthorizedParcelInputs(expedienteId, userId)
    if (!authorized) return false
    await this.persist(expedienteId, authorized.expediente.ownerId, result)
    return true
  }

  async recordManualContext(
    expedienteId: string,
    userId: string,
    input: ResolveParcelLocationInput,
    manualContext: ManualTerritorialContext
  ): Promise<TerritorialResolution | null> {
    const authorized = await loadAuthorizedParcelInputs(expedienteId, userId)
    if (!authorized) return null
    const result = createManualAttempt(input, manualContext, authorized.latestDetectionRaw)
    await this.persist(expedienteId, authorized.expediente.ownerId, result)
    return result
  }

  private async resolveAndPersist(
    expedienteId: string,
    authorized: NonNullable<Awaited<ReturnType<typeof loadAuthorizedParcelInputs>>>,
    input: ResolveParcelLocationInput,
    attemptStartedAt: string
  ) {
    const current = await this.resolver(input)
    current.attemptStartedAt = attemptStartedAt
    const result = attachContinuity(current, input, authorized.latestDetectionRaw)
    await this.persist(expedienteId, authorized.expediente.ownerId, result)
    return result
  }

  private async persist(expedienteId: string, ownerId: string, result: TerritorialResolution) {
    const effective = officialContextForUse(result)
    const allEvidence = [
      ...result.evidence,
      ...result.planning.evidence,
      ...result.affects.detected.map((affect) => affect.evidence),
      ...(effective && effective !== result
        ? [
            ...effective.evidence,
            ...effective.planning.evidence,
            ...effective.affects.detected.map((affect) => affect.evidence),
          ]
        : []),
    ]
    await db.insert(contextDetections).values({
      expedienteId,
      summary: detectionSummary(result),
      rawResponse: result,
      geometryStored: Boolean(effective?.parcelGeometry),
      sourceApis: [...new Set(allEvidence.map((item) => item.source))],
    })
    await db
      .update(expedientes)
      .set({ status: 'active' })
      .where(
        and(
          eq(expedientes.id, expedienteId),
          eq(expedientes.ownerId, ownerId),
          eq(expedientes.status, 'territorial_context_pending')
        )
      )
  }

  async detectStateless(
    input: ResolveParcelLocationInput | string
  ): Promise<TerritorialResolution> {
    return this.resolver(typeof input === 'string' ? { cadastralReference: input } : input)
  }
}
