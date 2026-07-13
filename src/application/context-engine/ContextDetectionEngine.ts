import { resolveParcelLocation } from '@/application/territorial-resolver/resolveParcelLocation'
import type {
  ResolveParcelLocationInput,
  TerritorialResolution,
} from '@/domain/territorial-resolver/types'
import { db } from '@/infrastructure/db/client'
import { contextDetections } from '@/infrastructure/db/schema'
import { loadAuthorizedParcelInputs } from '@/infrastructure/db/parcelContextRepository'
import { CatastroOfficialAdapter } from '@/infrastructure/territorial-resolver/CatastroOfficialAdapter'
import { CartoCiudadOfficialAdapter } from '@/infrastructure/territorial-resolver/CartoCiudadOfficialAdapter'
import { DatabasePlanningAdapter } from '@/infrastructure/territorial-resolver/DatabasePlanningAdapter'
import { IdegAffectAdapter } from '@/infrastructure/territorial-resolver/IdegAffectAdapter'
import { getMunicipalityByName, getProvinceByName } from '@/shared/territory'

type Resolver = (input: ResolveParcelLocationInput) => Promise<TerritorialResolution>

function officialResolver(): Resolver {
  const dependencies = {
    catastro: new CatastroOfficialAdapter(),
    geocoder: new CartoCiudadOfficialAdapter(),
    planning: new DatabasePlanningAdapter(),
    affects: new IdegAffectAdapter(),
  }
  return (input) => resolveParcelLocation(input, dependencies)
}

function detectionSummary(result: TerritorialResolution) {
  const province = getProvinceByName(result.province ?? '')
  const municipality = getMunicipalityByName(result.municipality ?? '')
  return {
    cadastralReference: result.cadastralReference,
    provinceId: province?.id,
    provinceName: result.province,
    provinceCode: result.provinceCode,
    municipalityId: municipality?.id,
    municipalityName: result.municipality,
    municipalityCode: result.municipalityCode,
    address: result.normalizedAddress,
    lat: result.coordinates?.lat,
    lng: result.coordinates?.lng,
    parcelGeometry: result.parcelGeometry,
    locationStatus: result.status,
    locationConfidence: result.confidence,
    locationSource: result.evidence.some((item) => item.source === 'catastro')
      ? 'catastro'
      : result.evidence.some((item) => item.source === 'cartociudad')
        ? 'cartociudad'
        : undefined,
    planningInstrument: result.planning.instrument,
    planningStatus: result.planning.status === 'determined' ? 'vigente' : undefined,
    planningSource: result.planning.evidence.some((item) => item.source === 'siotuga')
      ? 'siotuga'
      : result.planning.status === 'determined'
        ? 'urbanbrain'
        : undefined,
    warnings: result.warnings,
    conflicts: result.conflicts,
    affects: result.affects,
    resolvedAt: result.resolvedAt,
  }
}

export class ContextDetectionEngine {
  constructor(private readonly resolver: Resolver = officialResolver()) {}

  async detectContext(
    expedienteId: string,
    userId: string
  ): Promise<TerritorialResolution | null> {
    const authorized = await loadAuthorizedParcelInputs(expedienteId, userId)
    if (!authorized) return null

    const result = await this.resolver({
      cadastralReference: authorized.expediente.refCatastral,
      coordinates:
        authorized.expediente.lat !== null && authorized.expediente.lng !== null
          ? { lat: authorized.expediente.lat!, lng: authorized.expediente.lng! }
          : undefined,
      address: authorized.expediente.address,
      declaredMunicipality: authorized.expediente.municipio,
    })

    const allEvidence = [
      ...result.evidence,
      ...result.planning.evidence,
      ...result.affects.detected.map((affect) => affect.evidence),
    ]
    await db.insert(contextDetections).values({
      expedienteId,
      summary: detectionSummary(result),
      rawResponse: result,
      geometryStored: Boolean(result.parcelGeometry),
      sourceApis: [...new Set(allEvidence.map((item) => item.source))],
    })
    return result
  }

  async detectStateless(
    input: ResolveParcelLocationInput | string
  ): Promise<TerritorialResolution> {
    return this.resolver(
      typeof input === 'string' ? { cadastralReference: input } : input
    )
  }
}
