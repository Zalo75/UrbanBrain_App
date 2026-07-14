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

function firstRecord(payload: unknown): CatastroRecord | null {
  if (!payload || typeof payload !== 'object') return null
  const root = payload as Record<string, unknown>
  const result = (root.consulta_dnprcResult ?? root.Consulta_DNPRCResult) as
    | Record<string, unknown>
    | undefined
  const list = (result?.lrcdnp as Record<string, unknown> | undefined)?.rcdnp
  if (Array.isArray(list)) return (list[0] as CatastroRecord | undefined) ?? null
  return list && typeof list === 'object' ? (list as CatastroRecord) : null
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
        response.json()
      ),
      fetchOfficial(this.fetcher, 'Catastro', coordinatesUrl, this.timeoutMs).then((response) =>
        response.json()
      ),
      fetchOfficial(this.fetcher, 'Catastro INSPIRE', geometryUrl, this.timeoutMs).then((response) =>
        response.text()
      ),
    ])

    if (detailsState.status === 'rejected' && coordinatesState.status === 'rejected') {
      throw detailsState.reason
    }

    const record = detailsState.status === 'fulfilled' ? firstRecord(detailsState.value) : null
    const coordinate =
      coordinatesState.status === 'fulfilled' ? coordinateResult(coordinatesState.value) : null
    if (!record && !coordinate) return null

    const retrievedAt = this.now().toISOString()
    const result: CatastroParcel = {
      cadastralReference: parcelReference,
      normalizedAddress: coordinate?.address ?? addressFromRecord(record),
      municipality: record?.dt?.nm,
      municipalityCode:
        record?.dt?.loine?.cp && record.dt.loine.cm
          ? `${record.dt.loine.cp}${record.dt.loine.cm.padStart(3, '0')}`
          : undefined,
      province: record?.dt?.np,
      provinceCode: record?.dt?.loine?.cp,
      coordinates: coordinate?.coordinates,
      geometry:
        geometryState.status === 'fulfilled'
          ? parseCatastroGeometry(geometryState.value)
          : undefined,
      evidence: [],
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
      return referenceResult(await response.json())
    } catch {
      throw new OfficialServiceError('Catastro', 'malformed', 'Catastro devolvió una respuesta no válida.')
    }
  }
}
