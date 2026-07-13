import type {
  GeocoderPort,
  TerritorialCoordinates,
  TerritorialLocationCandidate,
} from '@/domain/territorial-resolver/types'
import {
  fetchOfficial,
  OfficialServiceError,
  type FetchLike,
} from '@/infrastructure/territorial-resolver/officialHttp'

const CARTOCIUDAD = 'https://www.cartociudad.es/geocoder/api/geocoder'

interface CartoCiudadCandidate {
  id?: string
  province?: string
  provinceCode?: string
  comunidadAutonomaCode?: string
  muni?: string
  muniCode?: string
  type?: string
  address?: string
  lat?: number
  lng?: number
  refCatastral?: string
  state?: number
}

export class CartoCiudadOfficialAdapter implements GeocoderPort {
  constructor(
    private readonly fetcher: FetchLike = fetch,
    private readonly timeoutMs = 8_000,
    private readonly now: () => Date = () => new Date()
  ) {}

  private async request(url: URL): Promise<unknown> {
    const response = await fetchOfficial(this.fetcher, 'CartoCiudad', url, this.timeoutMs)
    try {
      return await response.json()
    } catch {
      throw new OfficialServiceError(
        'CartoCiudad',
        'malformed',
        'CartoCiudad devolvió una respuesta no válida.'
      )
    }
  }

  private map(candidate: CartoCiudadCandidate, url: URL): TerritorialLocationCandidate | null {
    if (candidate.state !== undefined && candidate.state !== 0) return null
    const hasCoordinates =
      Number.isFinite(candidate.lat) &&
      Number.isFinite(candidate.lng) &&
      candidate.lat !== 0 &&
      candidate.lng !== 0
    return {
      cadastralReference: candidate.refCatastral || undefined,
      normalizedAddress: candidate.address || undefined,
      municipality: candidate.muni || undefined,
      municipalityCode: candidate.muniCode || undefined,
      province: candidate.province || undefined,
      provinceCode: candidate.provinceCode || undefined,
      coordinates: hasCoordinates ? { lat: candidate.lat!, lng: candidate.lng! } : undefined,
      sourceId: candidate.id,
      type: candidate.type,
      evidence: [
        {
          source: 'cartociudad',
          sourceUrl: url.toString(),
          retrievedAt: this.now().toISOString(),
          method: 'REST geocoder',
        },
      ],
    }
  }

  async geocode(address: string): Promise<TerritorialLocationCandidate[]> {
    const url = new URL(`${CARTOCIUDAD}/candidates`)
    url.search = new URLSearchParams({ q: address, limit: '5' }).toString()
    const payload = await this.request(url)
    if (!Array.isArray(payload)) {
      throw new OfficialServiceError(
        'CartoCiudad',
        'malformed',
        'CartoCiudad no devolvió una lista de candidatos.'
      )
    }
    return payload
      .filter(
        (candidate): candidate is CartoCiudadCandidate =>
          Boolean(candidate) &&
          typeof candidate === 'object' &&
          (candidate as CartoCiudadCandidate).comunidadAutonomaCode === '12'
      )
      .map((candidate) => this.map(candidate, url))
      .filter((candidate): candidate is TerritorialLocationCandidate => Boolean(candidate))
  }

  async reverse(coordinates: TerritorialCoordinates): Promise<TerritorialLocationCandidate | null> {
    const url = new URL(`${CARTOCIUDAD}/reverseGeocode`)
    url.search = new URLSearchParams({
      lon: String(coordinates.lng),
      lat: String(coordinates.lat),
    }).toString()
    const payload = await this.request(url)
    if (!payload || typeof payload !== 'object') return null
    const candidate = payload as CartoCiudadCandidate
    if (candidate.comunidadAutonomaCode !== '12') return null
    return this.map(candidate, url)
  }
}
