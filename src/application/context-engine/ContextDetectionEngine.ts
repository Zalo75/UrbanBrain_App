import { resolveParcelLocation } from '@/application/territorial-resolver/resolveParcelLocation'
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
import { db } from '@/infrastructure/db/client'
import { contextDetections } from '@/infrastructure/db/schema'
import { loadAuthorizedParcelInputs } from '@/infrastructure/db/parcelContextRepository'
import { CatastroOfficialAdapter } from '@/infrastructure/territorial-resolver/CatastroOfficialAdapter'
import { CartoCiudadOfficialAdapter } from '@/infrastructure/territorial-resolver/CartoCiudadOfficialAdapter'
import { DatabasePlanningAdapter } from '@/infrastructure/territorial-resolver/DatabasePlanningAdapter'
import { BetanzosPlanningAdapter } from '@/infrastructure/territorial-resolver/BetanzosPlanningAdapter'
import { IdegAffectAdapter } from '@/infrastructure/territorial-resolver/IdegAffectAdapter'
import { getMunicipalityByName, getProvinceByName } from '@/shared/territory'

type Resolver = (input: ResolveParcelLocationInput) => Promise<TerritorialResolution>

function officialResolver(): Resolver {
  const dependencies = {
    catastro: new CatastroOfficialAdapter(),
    geocoder: new CartoCiudadOfficialAdapter(),
    planning: new BetanzosPlanningAdapter(new DatabasePlanningAdapter()),
    affects: new IdegAffectAdapter(),
  }
  return (input) => resolveParcelLocation(input, dependencies)
}

function detectionSummary(result: TerritorialResolution) {
  const effective = officialContextForUse(result)
  const manual = result.continuity?.manualContext
  const province = getProvinceByName(effective?.province ?? '')
  const municipality = getMunicipalityByName(effective?.municipality ?? '')
  const landClass =
    effective?.planning.classification?.code === 'SU'
      ? 'urbano'
      : effective?.planning.classification?.code === 'SNR'
        ? 'nucleo_rural'
        : effective?.planning.classification?.code === 'SR'
          ? 'rustico'
          : manual?.classification
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
  return {
    cadastralReference: effective?.cadastralReference,
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
    planningApplicabilityStatus: effective?.planning.status ?? 'not_determined',
    planningCanAnswerConcreteParameters:
      effective?.planning.canAnswerConcreteParameters ?? false,
    planningWarnings: effective?.planning.warnings ?? [],
    planningConflicts: effective?.planning.conflicts ?? [],
    planningSource: effective?.planning.evidence.some((item) => item.source === 'siotuga')
      ? 'siotuga'
      : effective?.planning.status === 'determined'
        ? 'urbanbrain'
        : undefined,
    landClass,
    planningArea:
      effective?.planning.status !== 'conflict' && effective?.planning.areas?.length === 1
        ? effective.planning.areas[0].name
        : manual?.area,
    qualification: manual?.ordinance,
    manualContext: manual,
    reliability: {
      mode: reliabilityMode,
      latestAttemptAt: result.resolvedAt,
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
    affects: effective?.affects ?? result.affects,
    resolvedAt: result.resolvedAt,
  }
}

export class ContextDetectionEngine {
  constructor(private readonly resolver: Resolver = officialResolver()) {}

  async detectContext(expedienteId: string, userId: string): Promise<TerritorialResolution | null> {
    const authorized = await loadAuthorizedParcelInputs(expedienteId, userId)
    if (!authorized) return null

    return this.resolveAndPersist(expedienteId, authorized, {
      cadastralReference: authorized.expediente.refCatastral,
      coordinates:
        authorized.expediente.lat !== null && authorized.expediente.lng !== null
          ? { lat: authorized.expediente.lat!, lng: authorized.expediente.lng! }
          : undefined,
      address: authorized.expediente.address,
      declaredMunicipality: authorized.expediente.municipio,
    })
  }

  async detectContextFromInput(
    expedienteId: string,
    userId: string,
    input: ResolveParcelLocationInput
  ): Promise<TerritorialResolution | null> {
    const authorized = await loadAuthorizedParcelInputs(expedienteId, userId)
    if (!authorized) return null
    return this.resolveAndPersist(expedienteId, authorized, {
      ...input,
      declaredMunicipality: authorized.expediente.municipio,
    })
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
    await this.persist(expedienteId, result)
    return result
  }

  private async resolveAndPersist(
    expedienteId: string,
    authorized: NonNullable<Awaited<ReturnType<typeof loadAuthorizedParcelInputs>>>,
    input: ResolveParcelLocationInput
  ) {
    const current = await this.resolver(input)
    const result = attachContinuity(current, input, authorized.latestDetectionRaw)
    await this.persist(expedienteId, result)
    return result
  }

  private async persist(expedienteId: string, result: TerritorialResolution) {
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
  }

  async detectStateless(
    input: ResolveParcelLocationInput | string
  ): Promise<TerritorialResolution> {
    return this.resolver(typeof input === 'string' ? { cadastralReference: input } : input)
  }
}
