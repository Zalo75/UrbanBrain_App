import type {
  CatastroParcel,
  CatastroPort,
  ParcelGeometry,
  TerritorialCoordinates,
  TerritorialEvidence,
} from '@/domain/territorial-resolver/types'
import {
  fetchOfficial,
  OfficialServiceError,
  type FetchLike,
} from '@/infrastructure/territorial-resolver/officialHttp'
import { resolveMunicipalityIdentity } from '@/shared/territory'

const CATASTRO_COORDINATES =
  'https://ovc.catastro.meh.es/OVCServWeb/OVCWcfCallejero/COVCCoordenadas.svc/json'
const CATASTRO_STREET =
  'https://ovc.catastro.meh.es/OVCServWeb/OVCWcfCallejero/COVCCallejero.svc/json'
const CATASTRO_WFS = 'https://ovc.catastro.meh.es/INSPIRE/wfsCP.aspx'

interface CatastroRecord {
  dt?: {
    loine?: { cp?: string; cm?: string }
    np?: string
    nm?: string
    locs?: { lous?: { lourb?: { dir?: { tv?: string; nv?: string; pnp?: string } } } }
  }
}

function evidence(sourceUrl: string, retrievedAt: string, method: string): TerritorialEvidence {
  return { source: 'catastro', sourceUrl, retrievedAt, method }
}

async function officialGeometry(response: Response) {
  const xml = await response.text()
  const numberMatched = /numberMatched="(\d+)"/i.exec(xml)?.[1] ?? null
  const firstFeature = /<(?:(?:\w+):)?featureMember\b[^>]*>\s*<([\w.-]*:)?([\w.-]+)\b/i.exec(xml)?.[2] ?? null
  const hasGeometry = /<(?:gml:)?(?:Surface|Polygon|MultiSurface)\b/i.test(xml)
  const hasFeatureCollection = /<(?:(?:\w+):)?FeatureCollection\b/i.test(xml)
  const rootElement = /^\s*<\?xml[^>]*>\s*<([\w.-]*:)?([\w.-]+)/i.exec(xml)?.[2] ?? null
  const exceptionCode = /<(?:\w+:)?Exception[^>]*(?:code|exceptionCode)=["']([^"']+)["']/i.exec(xml)?.[1] ?? null
  const exceptionText = /<(?:\w+:)?ExceptionText[^>]*>([\s\S]*?)<\//i.exec(xml)?.[1]?.replace(/\s+/g, ' ').trim().slice(0, 240) ?? null
  console.log('UB-DIAG catastro-inspire-structure', JSON.stringify({ rootElement, numberMatched, firstFeature, hasGeometry, hasFeatureCollection, exceptionCode, exceptionText }))
  if (!hasFeatureCollection || !/numberMatched="\d+"/i.test(xml)) {
    const error = new OfficialServiceError(
      'Catastro INSPIRE',
      'malformed',
      'Catastro INSPIRE devolvió una respuesta no válida.'
    )
    console.log('UB-DIAG catastro-inspire-error', JSON.stringify({ message: error.message }))
    throw error
  }
  if (/numberMatched="0"/i.test(xml)) return undefined
  const geometry = parseCatastroGeometry(xml)
  if (!geometry) {
    const error = new OfficialServiceError(
      'Catastro INSPIRE',
      'malformed',
      'Catastro INSPIRE devolvió una geometría que no puede validarse.'
    )
    console.log('UB-DIAG catastro-inspire-error', JSON.stringify({ message: error.message }))
    throw error
  }
  return geometry
}

function jsonShape(payload: unknown, kind: 'dnprc' | 'cpmrc') {
  if (!payload || typeof payload !== 'object') return { rootKeys: [], result: false }
  const root = payload as Record<string, unknown>
  const resultKey = kind === 'dnprc'
    ? (Object.hasOwn(root, 'consulta_dnprcResult') ? 'consulta_dnprcResult' : Object.hasOwn(root, 'Consulta_DNPRCResult') ? 'Consulta_DNPRCResult' : null)
    : (Object.hasOwn(root, 'Consulta_CPMRCResult') ? 'Consulta_CPMRCResult' : Object.hasOwn(root, 'consulta_cpmrcResult') ? 'consulta_cpmrcResult' : null)
  const result = resultKey && root[resultKey] && typeof root[resultKey] === 'object'
    ? root[resultKey] as Record<string, unknown>
    : undefined
  const rcdnp = (result?.lrcdnp as Record<string, unknown> | undefined)?.rcdnp
  const bi = (result?.bico as Record<string, unknown> | undefined)?.bi
  const coordinates = result?.coordenadas as Record<string, unknown> | undefined
  const coord = coordinates?.coord
  const first = (Array.isArray(coord) ? coord[0] : coord) as Record<string, unknown> | undefined
  const geo = first?.geo as Record<string, unknown> | undefined
  const wrapperKeys = result ? Object.keys(result) : []
  const functionalFields = [...Object.keys(root), ...wrapperKeys].filter((key) => /error|fault|message|mensaje|status|estado|control|cuerr|lerr|code|codigo|text|texto/i.test(key))
  const functionalValues = [root, result].filter(Boolean).flatMap((value) =>
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => /error|fault|message|mensaje|status|estado|control|cuerr|lerr|code|codigo|text|texto/i.test(key))
      .map(([key, item]) => ({ key, value: typeof item === 'string' ? item.slice(0, 240) : typeof item === 'number' || typeof item === 'boolean' ? item : Array.isArray(item) ? `array(${item.length})` : item && typeof item === 'object' ? 'object' : item }))
  )
  return {
    rootKeys: Object.keys(root).slice(0, 20),
    resultKey,
    wrapperKeys: wrapperKeys.slice(0, 30),
    hasLrcdnp: Boolean(result?.lrcdnp),
    rcdnpCount: Array.isArray(rcdnp) ? rcdnp.length : rcdnp ? 1 : 0,
    hasBico: Boolean(result?.bico),
    biCount: Array.isArray(bi) ? bi.length : bi ? 1 : 0,
    hasCoordinates: Boolean(coordinates),
    coordCount: Array.isArray(coord) ? coord.length : coord ? 1 : 0,
    hasXcen: typeof geo?.xcen !== 'undefined',
    hasYcen: typeof geo?.ycen !== 'undefined',
    validXcen: Number.isFinite(Number(geo?.xcen)),
    validYcen: Number.isFinite(Number(geo?.ycen)),
    functionalFields: [...new Set(functionalFields)].slice(0, 30),
    functionalValues: functionalValues.slice(0, 30),
  }
}

async function officialJson(response: Response, service: string, expectedRoots: string[]) {
  try {
    const payload = await response.json()
    const kind = expectedRoots.some((root) => root.toLowerCase().includes('dnprc')) ? 'dnprc' : 'cpmrc'
    console.log(`UB-DIAG catastro-${kind}-structure`, JSON.stringify(jsonShape(payload, kind)))
    if (
      !payload ||
      typeof payload !== 'object' ||
      !expectedRoots.some((root) => Object.hasOwn(payload, root))
    ) {
      throw new Error('unexpected schema')
    }
    return payload
  } catch {
    throw new OfficialServiceError(
      service,
      'malformed',
      `${service} devolvi\u00f3 una respuesta no v\u00e1lida.`
    )
  }
}

function firstRecord(payload: unknown): CatastroRecord | null {
  if (!payload || typeof payload !== 'object') return null
  const root = payload as Record<string, unknown>
  const result = (root.consulta_dnprcResult ?? root.Consulta_DNPRCResult) as
    | Record<string, unknown>
    | undefined
  const list = (result?.lrcdnp as Record<string, unknown> | undefined)?.rcdnp
  if (Array.isArray(list)) return (list[0] as CatastroRecord | undefined) ?? null
  if (list && typeof list === 'object') return list as CatastroRecord
  // Consulta_DNPRC has two official JSON shapes in production. Newer
  // responses expose the cadastral unit under bico.bi instead of lrcdnp.rcdnp.
  const bico = result?.bico as Record<string, unknown> | undefined
  const bi = bico?.bi
  if (Array.isArray(bi)) return (bi[0] as CatastroRecord | undefined) ?? null
  return bi && typeof bi === 'object' ? (bi as CatastroRecord) : null
}

function addressFromRecord(record: CatastroRecord | null) {
  const dir = record?.dt?.locs?.lous?.lourb?.dir
  if (!dir) return undefined
  return [dir.tv, dir.nv, dir.pnp].filter(Boolean).join(' ').trim() || undefined
}

function coordinateResult(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null
  const root = payload as Record<string, unknown>
  const result = (root.Consulta_CPMRCResult ?? root.consulta_cpmrcResult) as
    | Record<string, unknown>
    | undefined
  const coordinates = result?.coordenadas as Record<string, unknown> | undefined
  const values = coordinates?.coord
  const first = (Array.isArray(values) ? values[0] : values) as
    | { geo?: { xcen?: string; ycen?: string }; ldt?: string }
    | undefined
  if (!first?.geo) return null
  const lng = Number(first.geo.xcen)
  const lat = Number(first.geo.ycen)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { coordinates: { lat, lng }, address: first.ldt } as const
}

function referenceResult(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null
  const root = payload as Record<string, unknown>
  const result = (root.Consulta_RCCOORResult ?? root.consulta_rccoorResult) as
    | Record<string, unknown>
    | undefined
  const coordinates = result?.coordenadas as Record<string, unknown> | undefined
  const values = coordinates?.coord
  const first = (Array.isArray(values) ? values[0] : values) as
    | { pc?: { pc1?: string; pc2?: string } }
    | undefined
  const reference = `${first?.pc?.pc1 ?? ''}${first?.pc?.pc2 ?? ''}`
  return reference.length === 14 ? reference : null
}

function representativePoint(geometry: ParcelGeometry): TerritorialCoordinates | undefined {
  const points = geometry.coordinates.flat(2)
  if (!points.length) return undefined
  const valid = points.filter(
    (point): point is [number, number] =>
      Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]),
  )
  if (!valid.length) return undefined
  return {
    lng: valid.reduce((sum, point) => sum + point[0], 0) / valid.length,
    lat: valid.reduce((sum, point) => sum + point[1], 0) / valid.length,
  }
}

export function parseCatastroGeometry(xml: string): ParcelGeometry | undefined {
  if (!/numberMatched="[1-9]\d*"/i.test(xml)) return undefined
  const polygons: number[][][][] = []
  const surfaces = xml.match(/<gml:Surface\b[\s\S]*?<\/gml:Surface>/gi) ?? []
  for (const surface of surfaces) {
    const exterior = surface.match(/<gml:exterior>[\s\S]*?<gml:posList[^>]*>([\s\S]*?)<\/gml:posList>[\s\S]*?<\/gml:exterior>/i)
    if (!exterior) continue
    const ordinates = exterior[1].trim().split(/\s+/).map(Number)
    if (ordinates.length < 8 || ordinates.some((value) => !Number.isFinite(value))) continue
    const ring: number[][] = []
    for (let index = 0; index < ordinates.length; index += 2) {
      ring.push([ordinates[index + 1], ordinates[index]])
    }
    polygons.push([ring])
  }
  return polygons.length ? { type: 'MultiPolygon', coordinates: polygons, crs: 'EPSG:4326' } : undefined
}

export class CatastroOfficialAdapter implements CatastroPort {
  constructor(
    private readonly fetcher: FetchLike = fetch,
    private readonly timeoutMs = 8_000,
    private readonly now: () => Date = () => new Date()
  ) {}

  async resolveReference(reference: string): Promise<CatastroParcel | null> {
    const startedAt = Date.now()
    const parcelReference = reference.slice(0, 14)
    const detailsUrl = new URL(`${CATASTRO_STREET}/Consulta_DNPRC`)
    detailsUrl.search = new URLSearchParams({
      Provincia: '',
      Municipio: '',
      RefCat: parcelReference,
    }).toString()
    const coordinatesUrl = new URL(`${CATASTRO_COORDINATES}/Consulta_CPMRC`)
    coordinatesUrl.search = new URLSearchParams({
      Provincia: '',
      Municipio: '',
      SRS: 'EPSG:4326',
      RefCat: parcelReference,
    }).toString()
    const geometryUrl = new URL(CATASTRO_WFS)
    geometryUrl.search = new URLSearchParams({
      service: 'WFS',
      version: '2.0.0',
      request: 'GetFeature',
      StoredQuerie_id: 'GetParcel',
      REFCAT: parcelReference,
    }).toString()

    const [detailsState, coordinatesState, geometryState] = await Promise.allSettled([
      fetchOfficial(this.fetcher, 'Catastro', detailsUrl, this.timeoutMs).then((response) =>
        officialJson(response, 'Catastro', ['consulta_dnprcResult', 'Consulta_DNPRCResult'])
      ),
      fetchOfficial(this.fetcher, 'Catastro', coordinatesUrl, this.timeoutMs).then((response) =>
        officialJson(response, 'Catastro', ['Consulta_CPMRCResult', 'consulta_cpmrcResult'])
      ),
      fetchOfficial(this.fetcher, 'Catastro INSPIRE', geometryUrl, this.timeoutMs).then(
        officialGeometry
      ),
    ])

    const record = detailsState.status === 'fulfilled' ? firstRecord(detailsState.value) : null
    const coordinate =
      coordinatesState.status === 'fulfilled' ? coordinateResult(coordinatesState.value) : null
    const geometry = geometryState.status === 'fulfilled' ? geometryState.value : undefined
    console.log('UB-DIAG catastro-reference', JSON.stringify({ reference: parcelReference, durationMs: Date.now() - startedAt, details: detailsState.status, coordinates: coordinatesState.status, geometry: geometryState.status, hasRecord: Boolean(record), hasCoordinates: Boolean(coordinate), hasGeometry: Boolean(geometry) }))
    if (!record && !coordinate) {
      if (!geometry) {
        console.log('UB-DIAG catastro-null', JSON.stringify({ reference: parcelReference, reason: detailsState.status === 'rejected' && coordinatesState.status === 'rejected' ? 'details_and_coordinates_failed_without_geometry' : 'no_record_or_coordinates_without_geometry', durationMs: Date.now() - startedAt }))
        if (detailsState.status === 'rejected' && coordinatesState.status === 'rejected') {
          throw detailsState.reason
        }
        return null
      }

      // INSPIRE GetParcel is an official, reference-scoped fallback. The first
      // five cadastral characters encode the municipality identity; use the
      // shared catalogue only to present that canonical code, never a name map.
      const retrievedAt = this.now().toISOString()
      const municipalityCode = parcelReference.slice(0, 5)
      const municipality = resolveMunicipalityIdentity({ municipalityCode })
      console.log('UB-DIAG catastro-fallback', JSON.stringify({ reference: parcelReference, reason: 'geometry_only', municipalityCode, durationMs: Date.now() - startedAt }))
      return {
        cadastralReference: parcelReference,
        municipality: municipality?.name,
        municipalityCode: municipality?.ineCode ?? municipalityCode,
        coordinates: representativePoint(geometry),
        geometry,
        evidence: [evidence(geometryUrl.toString(), retrievedAt, 'WFS GetParcel (identity fallback)')],
        sourceChecks: [
          {
            source: 'catastro',
            status: 'partial',
            checkedAt: retrievedAt,
            message: 'Catastro INSPIRE confirmó la parcela; los servicios JSON auxiliares no estaban disponibles.',
          },
        ],
      }
    }

    const retrievedAt = this.now().toISOString()
    const normalizedAddress = coordinate?.address ?? addressFromRecord(record)
    const rawMunicipalityCode =
      record?.dt?.loine?.cp && record.dt.loine.cm
        ? `${record.dt.loine.cp}${record.dt.loine.cm.padStart(3, '0')}`
        : undefined
    const municipality = resolveMunicipalityIdentity({
      municipality: record?.dt?.nm,
      municipalityCode: rawMunicipalityCode,
      address: normalizedAddress,
    })
    const result: CatastroParcel = {
      cadastralReference: parcelReference,
      normalizedAddress,
      municipality: municipality?.name ?? record?.dt?.nm,
      municipalityCode: municipality?.ineCode ?? rawMunicipalityCode,
      province: record?.dt?.np,
      provinceCode: record?.dt?.loine?.cp,
      coordinates: coordinate?.coordinates,
      geometry,
      evidence: [],
      sourceChecks: [
        {
          source: 'catastro',
          status:
            detailsState.status === 'fulfilled' &&
            coordinatesState.status === 'fulfilled' &&
            geometryState.status === 'fulfilled'
              ? 'available'
              : 'partial',
          checkedAt: retrievedAt,
          message:
            detailsState.status === 'fulfilled' &&
            coordinatesState.status === 'fulfilled' &&
            geometryState.status === 'fulfilled'
              ? 'Catastro respondi\u00f3 correctamente.'
              : 'Catastro respondi\u00f3 parcialmente; algunos datos de la parcela no pudieron comprobarse.',
        },
      ],
    }
    if (detailsState.status === 'fulfilled') {
      result.evidence.push(evidence(detailsUrl.toString(), retrievedAt, 'Consulta_DNPRC'))
    }
    if (coordinatesState.status === 'fulfilled') {
      result.evidence.push(evidence(coordinatesUrl.toString(), retrievedAt, 'Consulta_CPMRC'))
    }
    if (geometryState.status === 'fulfilled' && result.geometry) {
      result.evidence.push(evidence(geometryUrl.toString(), retrievedAt, 'WFS GetParcel'))
    }
    console.log('UB-DIAG catastro-success', JSON.stringify({ reference: parcelReference, durationMs: Date.now() - startedAt, municipalityCode: result.municipalityCode ?? null, hasRecord: Boolean(record), hasCoordinates: Boolean(coordinate), hasGeometry: Boolean(result.geometry) }))
    return result
  }

  async resolveCoordinates(coordinates: TerritorialCoordinates): Promise<string | null> {
    const url = new URL(`${CATASTRO_COORDINATES}/Consulta_RCCOOR`)
    url.search = new URLSearchParams({
      CoorX: String(coordinates.lng),
      CoorY: String(coordinates.lat),
      SRS: 'EPSG:4326',
    }).toString()
    const response = await fetchOfficial(this.fetcher, 'Catastro', url, this.timeoutMs)
    try {
      return referenceResult(
        await officialJson(response, 'Catastro', [
          'Consulta_RCCOORResult',
          'consulta_rccoorResult',
        ])
      )
    } catch {
      throw new OfficialServiceError('Catastro', 'malformed', 'Catastro devolvió una respuesta no válida.')
    }
  }
}
