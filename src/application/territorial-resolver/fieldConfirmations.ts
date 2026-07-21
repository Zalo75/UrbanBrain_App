import type { TerritorialResolution } from '@/domain/territorial-resolver/types'

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
    result.planning.status === 'determined' && hasOfficialEvidence(result, 'siotuga')

  return {
    cadastralReference:
      officialParcel && Boolean(result.cadastralReference) ? 'confirmed' : 'pending',
    coordinates: officialParcel && Boolean(result.coordinates) ? 'confirmed' : 'pending',
    municipality:
      officialParcel && Boolean(result.municipality) && Boolean(result.municipalityCode)
        ? 'confirmed'
        : 'pending',
    municipalityCode: officialParcel && Boolean(result.municipalityCode) ? 'confirmed' : 'pending',
    province: officialParcel && Boolean(result.province) ? 'confirmed' : 'pending',
    planning: officialPlanning && Boolean(result.planning.instrument) ? 'confirmed' : 'pending',
    classification:
      officialPlanning && Boolean(result.planning.classification?.label) ? 'confirmed' : 'pending',
  }
}
