import type { TerritorialResolution } from '@/domain/territorial-resolver/types'
import { getProvinceByMunicipalityIneCode } from '@/shared/territory'

export type TerritorialFieldConfirmation = 'confirmed' | 'pending'

export interface TerritorialFieldConfirmations {
  cadastralReference: TerritorialFieldConfirmation
  coordinates: TerritorialFieldConfirmation
  municipality: TerritorialFieldConfirmation
  municipalityCode: TerritorialFieldConfirmation
  province: TerritorialFieldConfirmation
  planning: TerritorialFieldConfirmation
  classification: TerritorialFieldConfirmation
}

function hasOfficialEvidence(result: TerritorialResolution, source: 'catastro' | 'siotuga') {
  return result.evidence.some((item) => item.source === source) ||
    result.planning.evidence.some((item) => item.source === source)
}

function hasOfficialPlanningEvidence(result: TerritorialResolution) {
  return result.planning.evidence.some(
    (item) =>
      item.source === 'siotuga' &&
      item.scope === 'planning_instrument' &&
      Boolean(item.sourceUrl.trim()) &&
      Boolean(item.method.trim())
  )
}

function hasOfficialClassificationEvidence(result: TerritorialResolution) {
  return result.planning.evidence.some(
    (item) => item.source === 'siotuga' && item.scope === 'planning_classification'
  )
}

function sameInstrumentName(first?: string, second?: string) {
  const normalize = (value?: string) =>
    value
      ?.normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLocaleLowerCase('es-ES')
  return Boolean(normalize(first)) && normalize(first) === normalize(second)
}

function planningStatusConfirmsInstrument(result: TerritorialResolution) {
  switch (result.planning.status) {
    case 'determined':
    case 'partial':
      return true
    case 'conflict':
      return Boolean(
        result.planning.applicableInstruments?.some(
          (instrument) =>
            instrument.status === 'current' &&
            sameInstrumentName(instrument.name, result.planning.instrument)
        )
      )
    case 'not_determined':
    default:
      return false
  }
}

/**
 * A field is confirmed only when the resolver has coherent official evidence for
 * it. Values inferred from a point geocode, manual selection or an incomplete
 * source response deliberately remain pending.
 */
export function territorialFieldConfirmations(
  result: TerritorialResolution
): TerritorialFieldConfirmations {
  const officialParcel = result.status === 'confirmed' && hasOfficialEvidence(result, 'catastro')
  const officialPlanning =
    Boolean(result.planning.instrument?.trim()) &&
    planningStatusConfirmsInstrument(result) &&
    hasOfficialPlanningEvidence(result)
  const officialClassification =
    result.planning.status === 'determined' &&
    hasOfficialClassificationEvidence(result)
  const provinceResolvedFromOfficialData = Boolean(
    getProvinceByMunicipalityIneCode(result.municipalityCode) ?? result.province?.trim()
  )

  return {
    cadastralReference:
      officialParcel && Boolean(result.cadastralReference) ? 'confirmed' : 'pending',
    coordinates: officialParcel && Boolean(result.coordinates) ? 'confirmed' : 'pending',
    municipality:
      officialParcel && Boolean(result.municipality) && Boolean(result.municipalityCode)
        ? 'confirmed'
        : 'pending',
    municipalityCode: officialParcel && Boolean(result.municipalityCode) ? 'confirmed' : 'pending',
    province: officialParcel && provinceResolvedFromOfficialData ? 'confirmed' : 'pending',
    planning: officialPlanning && Boolean(result.planning.instrument) ? 'confirmed' : 'pending',
    classification:
      officialPlanning &&
      officialClassification &&
      Boolean(result.planning.classification?.code?.trim()) &&
      Boolean(result.planning.classification?.label?.trim())
        ? 'confirmed'
        : 'pending',
  }
}
