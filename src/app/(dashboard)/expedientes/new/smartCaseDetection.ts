import type {
  ClassificationCandidate,
  OfficialSourceCheck,
  PlanningClassification,
  TerritorialResolution,
} from '@/domain/territorial-resolver/types'
import { officialResourceLinks } from '@/application/territorial-resolver/officialResourceLinks'
import {
  getMunicipalityById,
  getProvinceByMunicipalityIneCode,
  getProvinceById,
  getProvinceByName,
  resolveMunicipalityIdentity,
} from '@/shared/territory'
import type { Municipality } from '@/shared/territory'
import {
  territorialFieldConfirmations,
  type TerritorialFieldConfirmation,
} from '@/application/territorial-resolver/fieldConfirmations'

export const LAND_CLASS_OPTIONS = [
  { value: 'urbano_consolidado', label: 'Urbano consolidado' },
  { value: 'urbano_no_consolidado', label: 'Urbano no consolidado' },
  { value: 'urbanizable', label: 'Urbanizable' },
  { value: 'rustico_no_urbanizable', label: 'Rústico / no urbanizable' },
  { value: 'nucleo_rural', label: 'Núcleo rural' },
] as const

export type LandClassValue = (typeof LAND_CLASS_OPTIONS)[number]['value']
export type DetectionProgressStatus = 'pending' | 'calculating' | 'success' | 'not_determined' | 'incomplete'

export function municipalitiesForProvince(municipalities: Municipality[], provinceId: string) {
  return municipalities.filter((municipality) => municipality.provinceId === provinceId)
}

export interface DetectionProgressItem {
  id: string
  label: string
  status: DetectionProgressStatus
  detail: string
}

export interface SmartCaseDetection {
  detected: {
    cadastralReference?: string
    parcelReference?: string
    provinceId?: string
    provinceName?: string
    municipalityId?: string
    municipalityName?: string
    municipalityCode?: string
    address?: string
    lat?: number
    lng?: number
    parcelGeometry?: TerritorialResolution['parcelGeometry']
    planeamiento?: string
    landClass?: LandClassValue
    urbanPlanningZone?: string
    locationSource?: 'cadastral_reference' | 'address' | 'coordinates'
  }
  progress: DetectionProgressItem[]
  sourceChecks: OfficialSourceCheck[]
  affects: TerritorialResolution['affects']['detected']
  classificationResolution?: TerritorialResolution['planning']['classificationResolution']
}

export interface PreflightDetection extends SmartCaseDetection {
  result: TerritorialResolution
}

const incompleteStatuses = new Set(['partial', 'timeout', 'unavailable', 'malformed', 'ambiguous', 'conflict'])

function sourceChecks(result: TerritorialResolution) {
  const checks = [
    ...(result.sourceChecks ?? []),
    ...(result.planning.sourceChecks ?? []),
    ...(result.affects.sourceChecks ?? []),
  ]
  return checks.filter(
    (check, index) =>
      checks.findIndex((candidate) =>
        candidate.source === check.source &&
        candidate.status === check.status &&
        candidate.message === check.message
      ) === index
  )
}

function sourceState(checks: OfficialSourceCheck[], source: OfficialSourceCheck['source']) {
  const matching = checks.filter((check) => check.source === source)
  return {
    hasIncomplete: matching.some((check) => incompleteStatuses.has(check.status)),
    checked: matching.length > 0,
  }
}

function progress(
  id: string,
  label: string,
  value: string | number | undefined,
  incomplete = false,
  notDeterminedDetail = 'No determinado',
  confirmation: TerritorialFieldConfirmation = 'confirmed',
  pendingDetail = 'Pendiente de confirmar'
): DetectionProgressItem {
  if (value !== undefined && value !== '') {
    return confirmation === 'confirmed'
      ? { id, label, status: 'success', detail: String(value) }
      : { id, label, status: 'pending', detail: pendingDetail }
  }
  return {
    id,
    label,
    status: incomplete ? 'incomplete' : 'not_determined',
    detail: incomplete ? 'Comprobación incompleta o con error' : notDeterminedDetail,
  }
}

export function landClassFromClassification(classification?: PlanningClassification): LandClassValue | undefined {
  if (!classification) return undefined
  if (classification.code === 'SU' && classification.categoryCode === 'SUNC') {
    return 'urbano_no_consolidado'
  }
  if (classification.code === 'SU') return 'urbano_consolidado'
  if (classification.code === 'SNR') return 'nucleo_rural'
  if (classification.code === 'SR') return 'rustico_no_urbanizable'
  return undefined
}

export function landClassFromCandidate(candidate?: ClassificationCandidate) {
  return landClassFromClassification(candidate?.classification)
}

/** Maps an official resolver response to values that the creation form can safely reuse. */
export function summarizeSmartCaseDetection(result: TerritorialResolution): PreflightDetection {
  const checks = sourceChecks(result)
  const municipality = resolveMunicipalityIdentity({
    municipality: result.municipality,
    municipalityCode: result.municipalityCode,
    address: result.normalizedAddress,
  })
  const province =
    getProvinceByMunicipalityIneCode(result.municipalityCode) ??
    (municipality ? getProvinceById(municipality.provinceId) : undefined) ??
    getProvinceByName(result.province ?? '')
  const siotuga = sourceState(checks, 'siotuga')
  const ideg = sourceState(checks, 'ideg')
  const classification = result.planning.classification
  const classificationResolution = result.planning.classificationResolution
    ? {
        ...result.planning.classificationResolution,
        officialLinks: officialResourceLinks(result),
      }
    : undefined
  const landClass = landClassFromClassification(classification)
  const affects = result.affects.detected
  const confirmations = territorialFieldConfirmations(result)
  const locationPendingDetail = result.status === 'probable'
    ? 'Dato orientativo; pendiente de confirmar'
    : 'Pendiente de confirmar'

  return {
    detected: {
      cadastralReference: result.cadastralReference,
      parcelReference: result.parcelReference,
      provinceId: province?.id,
      provinceName: province?.name,
      municipalityId: municipality?.id,
      municipalityName: municipality?.name,
      municipalityCode: municipality?.ineCode ?? result.municipalityCode,
      address: result.normalizedAddress,
      lat: result.coordinates?.lat,
      lng: result.coordinates?.lng,
      parcelGeometry: result.parcelGeometry,
      planeamiento: result.planning.instrument,
      landClass,
      urbanPlanningZone:
        result.planning.status !== 'conflict' && result.planning.areas?.length === 1
          ? result.planning.areas[0].name
          : undefined,
      locationSource:
        result.inputMethod === 'cadastral_reference'
          ? 'cadastral_reference'
          : result.inputMethod === 'coordinates'
            ? 'coordinates'
            : result.inputMethod === 'address'
              ? 'address'
              : undefined,
    },
    progress: [
      progress('reference', 'Referencia catastral', result.cadastralReference, false, 'No determinada', confirmations.cadastralReference),
      progress('parcel', 'Parcela localizada', result.parcelGeometry ? 'Geometría oficial' : undefined, false, 'No determinada', confirmations.cadastralReference),
      progress('address', 'Dirección', result.normalizedAddress, false, 'No determinada', confirmations.municipality, locationPendingDetail),
      progress('province', 'Provincia', province?.name, false, 'No determinada', confirmations.province, locationPendingDetail),
      progress('municipality', 'Municipio', municipality?.name, false, 'No determinado', confirmations.municipality, locationPendingDetail),
      progress('ine', 'Código INE', municipality?.ineCode ?? result.municipalityCode, false, 'No determinado', confirmations.municipalityCode, locationPendingDetail),
      progress('coordinates', 'Coordenadas', result.coordinates ? (result.inputMethod === 'coordinates' && confirmations.coordinates === 'pending' ? 'Punto aportado' : 'Coordenadas resueltas') : undefined, false, 'No determinadas', confirmations.coordinates, result.inputMethod === 'coordinates' ? 'Punto aportado; pendiente de confirmar' : locationPendingDetail),
      progress('planning', 'Planeamiento consultado', result.planning.instrument, siotuga.hasIncomplete, 'No determinado', confirmations.planning),
      progress(
        'classification',
        'Clasificación consultada',
        classification?.label,
        classificationResolution?.status === 'source_unavailable' || siotuga.hasIncomplete,
        classificationResolution?.status === 'multiple_intersections'
          ? `${classificationResolution.candidates.length} clasificaciones detectadas; seleccione el valor operativo`
          : classificationResolution?.status === 'review_required'
            ? 'Existe evidencia oficial, pero requiere revisión profesional'
            : classificationResolution?.status === 'not_available'
              ? 'Las fuentes consultadas no ofrecen información suficiente'
              : 'No determinada',
        confirmations.classification
      ),
      affects.length
        ? { id: 'affects', label: 'Afecciones consultadas', status: 'success', detail: `${affects.length} positiva(s) detectada(s)` }
        : progress(
            'affects',
            'Afecciones consultadas',
            undefined,
            ideg.hasIncomplete,
            ideg.checked ? 'Sin afecciones positivas detectadas' : 'No comprobado'
          ),
    ],
    sourceChecks: checks,
    affects,
    classificationResolution,
    result,
  }
}

export interface SmartCaseSubmission {
  provinceId: string
  municipalityId: string
  cadastralReference?: string | null
  address?: string | null
  lat?: number | null
  lng?: number | null
  planeamiento?: string | null
  landClass?: string | null
  urbanPlanningZone?: string | null
}

export function validateSmartCaseSubmission(
  input: SmartCaseSubmission,
  detection?: SmartCaseDetection
): string | null {
  const municipality = getMunicipalityById(input.municipalityId)
  if (!municipality || !municipality.enabled) return 'municipality_invalid'
  if (municipality.provinceId !== input.provinceId) return 'municipality_province_mismatch'

  if (!detection) return null
  const expected = detection.detected
  const normalizedReference = input.cadastralReference?.replace(/[^a-z0-9]/gi, '').toUpperCase()
  if (expected.cadastralReference && normalizedReference && normalizedReference !== expected.cadastralReference) return 'detection_mismatch'
  if (expected.provinceId && input.provinceId !== expected.provinceId) return 'detection_mismatch'
  if (expected.municipalityId && input.municipalityId !== expected.municipalityId) return 'detection_mismatch'
  if (expected.address && input.address?.trim() && input.address.trim() !== expected.address) return 'detection_mismatch'
  if (expected.locationSource !== 'coordinates' && expected.lat !== undefined && input.lat !== expected.lat) return 'detection_mismatch'
  if (expected.locationSource !== 'coordinates' && expected.lng !== undefined && input.lng !== expected.lng) return 'detection_mismatch'
  return null
}
