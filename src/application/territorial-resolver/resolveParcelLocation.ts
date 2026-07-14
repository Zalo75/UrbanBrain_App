import type {
  AffectPort,
  CatastroParcel,
  CatastroPort,
  GeocoderPort,
  PlanningApplicability,
  PlanningPort,
  ResolveParcelLocationInput,
  OfficialSource,
  OfficialSourceCheck,
  OfficialSourceCheckStatus,
  TerritorialAffect,
  TerritorialCoordinates,
  TerritorialLocationCandidate,
  TerritorialResolution,
  TerritorialWarning,
} from '@/domain/territorial-resolver/types'
import { officialFailureKind } from '@/infrastructure/territorial-resolver/officialHttp'

const GALICIA_BOUNDS = { minLat: 41.8, maxLat: 43.9, minLng: -9.4, maxLng: -6.7 }

export interface TerritorialResolverDependencies {
  catastro: CatastroPort
  geocoder: GeocoderPort
  planning: PlanningPort
  affects: AffectPort
  now?: () => Date
}

export function normalizeCadastralReference(reference: string | null | undefined): string | null {
  if (!reference) return null
  const normalized = reference.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return [14, 18, 20].includes(normalized.length) ? normalized : null
}

function parcelReference(reference: string) {
  return reference.slice(0, 14)
}

function isValidCoordinates(value: TerritorialCoordinates | null | undefined) {
  return Boolean(
    value &&
    Number.isFinite(value.lat) &&
    Number.isFinite(value.lng) &&
    value.lat >= -90 &&
    value.lat <= 90 &&
    value.lng >= -180 &&
    value.lng <= 180
  )
}

function isInGalicia(value: TerritorialCoordinates) {
  return (
    value.lat >= GALICIA_BOUNDS.minLat &&
    value.lat <= GALICIA_BOUNDS.maxLat &&
    value.lng >= GALICIA_BOUNDS.minLng &&
    value.lng <= GALICIA_BOUNDS.maxLng
  )
}

function comparable(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
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

function warning(code: string, message: string): TerritorialWarning {
  return { code, message }
}

const SOURCE_LABELS: Record<OfficialSource, string> = {
  catastro: 'Catastro',
  cartociudad: 'CartoCiudad',
  siotuga: 'SIOTUGA',
  ideg: 'IDEG',
}

function sourceCheck(
  source: OfficialSource,
  status: OfficialSourceCheckStatus,
  checkedAt: string,
  message?: string
): OfficialSourceCheck {
  const label = SOURCE_LABELS[source]
  const defaultMessage: Record<OfficialSourceCheckStatus, string> = {
    available: `${label} respondio correctamente.`,
    partial: `${label} solo pudo completar parte de la comprobacion.`,
    timeout: `${label} esta tardando mas de lo esperado. La comprobacion queda pendiente.`,
    unavailable: `${label} no esta respondiendo correctamente en este momento.`,
    malformed: `${label} devolvio una respuesta que no puede validarse con suficiente fiabilidad.`,
    not_found: `${label} respondio correctamente, pero no encontro el dato consultado.`,
    ambiguous: `${label} devolvio varios resultados posibles que requieren seleccion.`,
    conflict: `${label} devolvio datos incompatibles que requieren revision.`,
  }
  return { source, status, checkedAt, message: message ?? defaultMessage[status] }
}

function failedSourceCheck(
  source: OfficialSource,
  error: unknown,
  checkedAt: string
): OfficialSourceCheck {
  const kind = officialFailureKind(error)
  return sourceCheck(
    source,
    kind === 'timeout' ? 'timeout' : kind === 'malformed' ? 'malformed' : 'unavailable',
    checkedAt
  )
}

function emptyPlanning(message: string): PlanningApplicability {
  return {
    status: 'not_determined',
    evidence: [],
    warnings: [warning('planning_not_determined', message)],
  }
}

function emptyAffects(message: string) {
  return {
    analysisGeometry: 'none' as const,
    detected: [] as TerritorialAffect[],
    canRuleOutUndetectedAffects: false as const,
    warnings: [warning('affects_not_determined', message)],
  }
}

function baseResolution(
  now: Date,
  inputMethod: TerritorialResolution['inputMethod']
): TerritorialResolution {
  return {
    status: 'unresolved',
    confidence: 'low',
    inputMethod,
    candidates: [],
    evidence: [],
    warnings: [],
    conflicts: [],
    sourceChecks: [],
    planning: emptyPlanning('No se ha resuelto un municipio oficial.'),
    affects: emptyAffects('No se ha resuelto una localización consultable.'),
    resolvedAt: now.toISOString(),
  }
}

function applyParcel(result: TerritorialResolution, parcel: CatastroParcel) {
  if (!parcel.evidence.length) {
    result.warnings.push(
      warning('provenance_missing', 'Se descartó una respuesta territorial sin procedencia.')
    )
    return false
  }
  result.status = 'confirmed'
  result.confidence = parcel.sourceChecks?.some((check) => check.status !== 'available')
    ? 'medium'
    : 'high'
  result.cadastralReference = parcel.cadastralReference
  result.normalizedAddress = parcel.normalizedAddress
  result.municipality = parcel.municipality
  result.municipalityCode = parcel.municipalityCode
  result.province = parcel.province
  result.provinceCode = parcel.provinceCode
  result.coordinates = parcel.coordinates
  result.parcelGeometry = parcel.geometry
  result.evidence.push(...parcel.evidence)
  result.sourceChecks!.push(
    ...(parcel.sourceChecks ?? [sourceCheck('catastro', 'available', result.resolvedAt)])
  )
  if (!parcel.geometry) {
    result.warnings.push(
      warning(
        'parcel_geometry_unavailable',
        'No se obtuvo geometría de parcela; el análisis espacial sólo puede usar un punto.'
      )
    )
  }
  return true
}

async function addApplicability(
  result: TerritorialResolution,
  dependencies: TerritorialResolverDependencies
) {
  if (result.status === 'unresolved' || result.status === 'ambiguous') return

  const [planning, affects] = await Promise.allSettled([
    dependencies.planning.findApplicablePlanning({
      municipalityCode: result.municipalityCode,
      coordinates: result.coordinates,
      geometry: result.parcelGeometry,
    }),
    dependencies.affects.findAffects({
      coordinates: result.coordinates,
      geometry: result.parcelGeometry,
    }),
  ])
  if (planning.status === 'fulfilled') result.planning = planning.value
  else {
    result.planning = emptyPlanning('La consulta de planeamiento no está disponible temporalmente.')
  }
  if (planning.status === 'rejected') {
    result.planning.sourceChecks = [failedSourceCheck('siotuga', planning.reason, result.resolvedAt)]
  }
  if (affects.status === 'fulfilled') result.affects = affects.value
  else {
    result.affects = emptyAffects(
      'La consulta oficial de afecciones no está disponible temporalmente.'
    )
  }
  if (affects.status === 'rejected') {
    result.affects.sourceChecks = [failedSourceCheck('ideg', affects.reason, result.resolvedAt)]
  }
}

async function resolveByReference(
  reference: string,
  input: ResolveParcelLocationInput,
  dependencies: TerritorialResolverDependencies,
  now: Date
) {
  const result = baseResolution(now, 'cadastral_reference')
  let parcel: CatastroParcel | null
  try {
    parcel = await dependencies.catastro.resolveReference(parcelReference(reference))
  } catch (error) {
    const check = failedSourceCheck('catastro', error, result.resolvedAt)
    result.sourceChecks!.push(check)
    result.warnings.push(
      warning('official_service_unavailable', 'Catastro no está disponible temporalmente.')
    )
    return result
  }
  if (!parcel) {
    result.sourceChecks!.push(sourceCheck('catastro', 'not_found', result.resolvedAt))
    result.warnings.push(
      warning(
        'cadastral_reference_not_found',
        'Catastro no devolvió una parcela para la referencia.'
      )
    )
    return result
  }

  if (!applyParcel(result, parcel)) return result

  if (isValidCoordinates(input.coordinates) && parcel.coordinates) {
    const distance = distanceMetres(input.coordinates!, parcel.coordinates)
    if (distance > 100) {
      result.conflicts.push({
        field: 'coordinates',
        authoritativeValue: `${parcel.coordinates.lat},${parcel.coordinates.lng}`,
        conflictingValue: `${input.coordinates!.lat},${input.coordinates!.lng}`,
        reason: `Las coordenadas aportadas están a ${Math.round(distance)} m del centro catastral.`,
      })
    }
  }

  if (
    input.declaredMunicipality?.trim() &&
    parcel.municipality &&
    comparable(input.declaredMunicipality) !== comparable(parcel.municipality)
  ) {
    result.conflicts.push({
      field: 'municipality',
      authoritativeValue: parcel.municipality,
      conflictingValue: input.declaredMunicipality.trim(),
      reason: 'El municipio declarado no coincide con el municipio devuelto por Catastro.',
    })
  }

  if (
    input.address?.trim() &&
    parcel.normalizedAddress &&
    !comparable(parcel.normalizedAddress).includes(comparable(input.address)) &&
    !comparable(input.address).includes(comparable(parcel.normalizedAddress))
  ) {
    result.conflicts.push({
      field: 'address',
      authoritativeValue: parcel.normalizedAddress,
      conflictingValue: input.address.trim(),
      reason: 'La dirección aportada no coincide de forma suficiente con la dirección catastral.',
    })
  }

  if (result.conflicts.length) {
    result.sourceChecks!.push(sourceCheck('catastro', 'conflict', result.resolvedAt))
    result.warnings.push(
      warning('input_conflict', 'Existen discrepancias que requieren revisión técnica.')
    )
  }
  await addApplicability(result, dependencies)
  return result
}

async function resolveByCoordinates(
  coordinates: TerritorialCoordinates,
  dependencies: TerritorialResolverDependencies,
  now: Date
) {
  const result = baseResolution(now, 'coordinates')
  if (!isValidCoordinates(coordinates)) {
    result.warnings.push(warning('invalid_coordinates', 'Las coordenadas no son válidas.'))
    return result
  }
  if (!isInGalicia(coordinates)) {
    result.warnings.push(
      warning(
        'outside_galicia_coverage',
        'Las coordenadas están fuera de la cobertura beta de Galicia.'
      )
    )
    return result
  }

  let reference: string | null = null
  try {
    reference = await dependencies.catastro.resolveCoordinates(coordinates)
  } catch (error) {
    const check = failedSourceCheck('catastro', error, result.resolvedAt)
    result.sourceChecks!.push(check)
    result.warnings.push(
      warning(
        'catastro_coordinates_unavailable',
        'No se pudo consultar la parcela por coordenadas.'
      )
    )
  }
  if (reference) {
    const resolved = await resolveByReference(reference, { coordinates }, dependencies, now)
    if (resolved.status !== 'unresolved') {
      resolved.inputMethod = 'coordinates'
      return resolved
    }
    result.warnings.push(...resolved.warnings)
    result.sourceChecks!.push(...(resolved.sourceChecks ?? []))
  } else if (!result.sourceChecks!.some((check) => check.source === 'catastro')) {
    result.sourceChecks!.push(sourceCheck('catastro', 'not_found', result.resolvedAt))
  }

  let candidate: TerritorialLocationCandidate | null = null
  try {
    candidate = await dependencies.geocoder.reverse(coordinates)
  } catch (error) {
    const check = failedSourceCheck('cartociudad', error, result.resolvedAt)
    result.sourceChecks!.push(check)
    result.warnings.push(
      warning(
        'geocoder_unavailable',
        'La geocodificación inversa no está disponible temporalmente.'
      )
    )
  }
  result.coordinates = coordinates
  result.status = candidate ? 'probable' : 'unresolved'
  result.confidence = candidate ? 'medium' : 'low'
  if (candidate) {
    result.sourceChecks!.push(sourceCheck('cartociudad', 'available', result.resolvedAt))
    result.normalizedAddress = candidate.normalizedAddress
    result.municipality = candidate.municipality
    result.municipalityCode = candidate.municipalityCode
    result.province = candidate.province
    result.provinceCode = candidate.provinceCode
    result.cadastralReference = candidate.cadastralReference
    result.evidence.push(...candidate.evidence)
  }
  result.warnings.push(
    warning(
      'point_only_location',
      'No se confirmó una parcela catastral; la ubicación queda limitada al punto aportado.'
    )
  )
  await addApplicability(result, dependencies)
  return result
}

async function resolveByAddress(
  address: string,
  dependencies: TerritorialResolverDependencies,
  now: Date
) {
  const result = baseResolution(now, 'address')
  let candidates: TerritorialLocationCandidate[]
  try {
    candidates = (await dependencies.geocoder.geocode(address)).filter(
      (candidate) => !candidate.coordinates || isInGalicia(candidate.coordinates)
    )
  } catch (error) {
    const check = failedSourceCheck('cartociudad', error, result.resolvedAt)
    result.sourceChecks!.push(check)
    result.warnings.push(
      warning('geocoder_unavailable', 'La geocodificación no está disponible temporalmente.')
    )
    return result
  }
  result.candidates = candidates
  result.evidence.push(...candidates.flatMap((candidate) => candidate.evidence))

  if (candidates.length !== 1) {
    result.status = candidates.length > 1 ? 'ambiguous' : 'unresolved'
    result.sourceChecks!.push(
      sourceCheck(
        'cartociudad',
        candidates.length > 1 ? 'ambiguous' : 'not_found',
        result.resolvedAt
      )
    )
    result.warnings.push(
      warning(
        candidates.length > 1 ? 'ambiguous_address' : 'address_not_found',
        candidates.length > 1
          ? 'La dirección tiene varios candidatos y debe ser confirmada por el usuario.'
          : 'No se encontró un candidato oficial para la dirección.'
      )
    )
    return result
  }

  const candidate = candidates[0]
  result.sourceChecks!.push(sourceCheck('cartociudad', 'available', result.resolvedAt))
  if (candidate.cadastralReference) {
    let parcel: CatastroParcel | null = null
    try {
      parcel = await dependencies.catastro.resolveReference(
        parcelReference(candidate.cadastralReference)
      )
    } catch (error) {
      const check = failedSourceCheck('catastro', error, result.resolvedAt)
      result.sourceChecks!.push(check)
      result.warnings.push(
        warning(
          'catastro_confirmation_unavailable',
          'No se pudo confirmar el candidato contra Catastro.'
        )
      )
    }
    if (parcel) {
      if (applyParcel(result, parcel)) {
        result.inputMethod = 'address'
        await addApplicability(result, dependencies)
        return result
      }
    }
  }

  if (!candidate.coordinates) {
    result.status = 'ambiguous'
    result.warnings.push(
      warning(
        'address_candidate_has_no_point',
        'El candidato no incluye coordenadas y requiere una selección o consulta adicional.'
      )
    )
    return result
  }

  result.status = 'probable'
  result.confidence = 'medium'
  result.normalizedAddress = candidate.normalizedAddress
  result.municipality = candidate.municipality
  result.municipalityCode = candidate.municipalityCode
  result.province = candidate.province
  result.provinceCode = candidate.provinceCode
  result.coordinates = candidate.coordinates
  result.cadastralReference = candidate.cadastralReference
  result.warnings.push(
    warning(
      'address_not_cadastrally_confirmed',
      'La geocodificación no quedó confirmada contra una parcela de Catastro.'
    )
  )
  await addApplicability(result, dependencies)
  return result
}

export async function resolveParcelLocation(
  input: ResolveParcelLocationInput,
  dependencies: TerritorialResolverDependencies
): Promise<TerritorialResolution> {
  const now = (dependencies.now ?? (() => new Date()))()
  const reference = normalizeCadastralReference(input.cadastralReference)
  if (input.cadastralReference?.trim() && !reference) {
    const result = baseResolution(now, 'cadastral_reference')
    result.warnings.push(
      warning(
        'invalid_cadastral_reference',
        'La referencia catastral debe tener 14, 18 o 20 caracteres alfanuméricos.'
      )
    )
    return result
  }
  if (reference) return resolveByReference(reference, input, dependencies, now)
  if (input.coordinates) return resolveByCoordinates(input.coordinates, dependencies, now)
  if (input.address?.trim()) return resolveByAddress(input.address.trim(), dependencies, now)
  return baseResolution(now, 'none')
}
