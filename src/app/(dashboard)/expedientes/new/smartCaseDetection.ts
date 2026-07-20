import type {
  OfficialSourceCheck,
  PlanningClassification,
  TerritorialResolution,
} from '@/domain/territorial-resolver/types'
import {
  getMunicipalityById,
  getProvinceById,
  getProvinceByName,
  resolveMunicipalityIdentity,
} from '@/shared/territory'
import type { Municipality } from '@/shared/territory'

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
    planeamiento?: string
    landClass?: LandClassValue
    urbanPlanningZone?: string
    locationSource?: 'cadastral_reference' | 'address' | 'coordinates'
  }
  progress: DetectionProgressItem[]
  sourceChecks: OfficialSourceCheck[]
  affects: TerritorialResolution['affects']['detected']
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
  notDeterminedDetail = 'No determinado'
): DetectionProgressItem {
  if (value !== undefined && value !== '') {
    return { id, label, status: 'success', detail: String(value) }
  }
  return {
    id,
    label,
    status: incomplete ? 'incomplete' : 'not_determined',
    detail: incomplete ? 'Comprobación incompleta o con error' : notDeterminedDetail,
  }
}

function landClassFromClassification(classification?: PlanningClassification): LandClassValue | undefined {
  if (!classification) return undefined
  if (classification.code === 'SU') return 'urbano_consolidado'
  if (classification.code === 'SNR') return 'nucleo_rural'
  if (classification.code === 'SR') return 'rustico_no_urbanizable'
  return undefined
}

/** Maps an official resolver response to values that the creation form can safely reuse. */
export function summarizeSmartCaseDetection(result: TerritorialResolution): PreflightDetection {
  const checks = sourceChecks(result)
  const municipality = resolveMunicipalityIdentity({
    municipality: result.municipality,
    municipalityCode: result.municipalityCode,
    address: result.normalizedAddress,
  })
  const province = municipality
    ? getProvinceById(municipality.provinceId)
    : getProvinceByName(result.province ?? '')
  const siotuga = sourceState(checks, 'siotuga')
  const ideg = sourceState(checks, 'ideg')
  const classification = result.planning.classification
  const landClass = landClassFromClassification(classification)
  const affects = result.affects.detected

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
      progress('reference', 'Referencia catastral validada', result.cadastralReference),
      progress('parcel', 'Parcela localizada', result.parcelGeometry ? 'Geometría oficial' : undefined),
      progress('address', 'Dirección obtenida', result.normalizedAddress),
      progress('province', 'Provincia identificada', province?.name),
      progress('municipality', 'Municipio identificado', municipality?.name),
      progress('ine', 'Código INE obtenido', municipality?.ineCode ?? result.municipalityCode),
      progress('coordinates', 'Coordenadas obtenidas', result.coordinates ? 'Coordenadas oficiales' : undefined),
      progress('planning', 'Planeamiento consultado', result.planning.instrument, siotuga.hasIncomplete),
      progress('classification', 'Clasificación consultada', classification?.label, siotuga.hasIncomplete),
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
  if (expected.cadastralReference && normalizedReference !== expected.cadastralReference) return 'detection_mismatch'
  if (expected.provinceId && input.provinceId !== expected.provinceId) return 'detection_mismatch'
  if (expected.municipalityId && input.municipalityId !== expected.municipalityId) return 'detection_mismatch'
  if (expected.address && input.address?.trim() !== expected.address) return 'detection_mismatch'
  if (expected.lat !== undefined && input.lat !== expected.lat) return 'detection_mismatch'
  if (expected.lng !== undefined && input.lng !== expected.lng) return 'detection_mismatch'
  if (expected.planeamiento && input.planeamiento?.trim() !== expected.planeamiento) return 'detection_mismatch'
  if (expected.landClass && input.landClass !== expected.landClass) return 'detection_mismatch'
  if (expected.urbanPlanningZone && input.urbanPlanningZone?.trim() !== expected.urbanPlanningZone) return 'detection_mismatch'
  return null
}
