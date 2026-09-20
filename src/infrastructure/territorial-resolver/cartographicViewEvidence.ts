import { createHash } from 'node:crypto'
import type { CartographicToolResult, CartographicViewArguments, CartographicViewMetadata } from '@/application/parcel-context/cartographicViewTool'
import { parseCartographicArguments } from '@/application/parcel-context/cartographicViewTool'
import type { PlanningApplicability } from '@/domain/territorial-resolver/types'
import { discoverSiotugaResources } from './SiotugaResourceDiscovery'
import { fetchOfficial, type FetchLike } from './officialHttp'
import { decodePng } from './parcelMapOverlay'
import { renderCartographicAlignment } from './cartographicAlignmentOverlay'

const IGN = 'https://www.ign.es/wms-inspire/ign-base'
const SIOTUGA = 'https://siotuga.xunta.gal/siotuga/ws'
const MAX_BYTES = 12 * 1024 * 1024
const MAX_STORED_BYTES = 48 * 1024 * 1024
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
type StoredView = { metadata: CartographicViewMetadata; bytes: Uint8Array }
export interface CartographicEvidenceContext {
  expedienteId: string
  municipalityCode: string | null | undefined
  instrumentId: string | null | undefined
  planning: PlanningApplicability | null | undefined
  signal?: AbortSignal
}

export interface HasCartographicInput {
  kind: 'historical' | 'modern'
  src: string
  width: number
  height: number
  provenance: CartographicViewMetadata
}

/** Evidence and derived renders are scoped to this authorized chat turn.
 * No zoning inference, original-document georeference or persisted alignment. */
export class CartographicViewEvidence {
  private views = new Map<string, StoredView>()
  private historicalLayer?: string
  constructor(private context: CartographicEvidenceContext, private fetcher: FetchLike = fetch) {}

  attachments(result: CartographicToolResult) {
    return result.views.map(metadata => ({ id: metadata.id, label: `${metadata.kind}: ${JSON.stringify(metadata)}`, mediaType: 'image/png' as const, data: Buffer.from(this.views.get(metadata.id)!.bytes).toString('base64') }))
  }

  async acquireHasPair(args: Extract<CartographicViewArguments, { operation: 'acquire' }>): Promise<{ inputs: HasCartographicInput[]; limitations: string[] }> {
    const result = await this.execute({ ...args, representation: 'pair' })
    const inputs = result.views
      .filter(view => view.kind === 'historical' || view.kind === 'modern')
      .map(view => ({
        kind: view.kind as 'historical' | 'modern',
        src: `data:image/png;base64,${Buffer.from(this.views.get(view.id)!.bytes).toString('base64')}`,
        width: view.width,
        height: view.height,
        provenance: view,
      }))
    return { inputs, limitations: result.limitations }
  }
  private async request(url: URL) {
    const response = await fetchOfficial(this.fetcher, 'Cartographic WMS', url, 10_000, { signal: this.context.signal, redirect: 'error' }, { maxRetries: 2, baseDelayMs: 250 })
    if (!(response.headers.get('content-type') ?? '').toLowerCase().startsWith('image/png')) throw new Error('WMS did not return image/png')
    const length = Number(response.headers.get('content-length'))
    if (length > MAX_BYTES) throw new Error('Raster exceeds byte limit')
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Empty raster')
    const parts: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        this.context.signal?.throwIfAborted()
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > MAX_BYTES) throw new Error('Raster exceeds byte limit')
        parts.push(value)
      }
    } catch (error) { await reader.cancel(); throw error }
    return Buffer.concat(parts)
  }
  private store(bytes: Uint8Array, metadata: Omit<CartographicViewMetadata, 'id' | 'checksum'>) {
    const checksum = hash(bytes)
    const id = `cartographic-view:${hash(JSON.stringify({ ...metadata, queriedAt: undefined, checksum }))}`
    const existing = this.views.get(id)
    if (existing) return existing
    const storedBytes = [...this.views.values()].reduce((sum, view) => sum + view.bytes.length, 0)
    if (this.views.size >= 32 || storedBytes + bytes.length > MAX_STORED_BYTES) throw new Error('Turn image limit reached')
    const view = { bytes, metadata: { ...metadata, id, checksum } }
    this.views.set(id, view)
    return view
  }
  private async acquire(kind: 'historical' | 'modern' | 'legend', args: CartographicViewArguments) {
    let layer = 'IGNBaseTodo-nofondo'
    if (kind !== 'modern') {
      if (!this.historicalLayer) {
        const signal = this.context.signal
        const scopedFetch: FetchLike = (input, init) => this.fetcher(input, { ...init, redirect: 'error', signal: signal && init?.signal ? AbortSignal.any([signal, init.signal]) : signal ?? init?.signal })
        this.historicalLayer = (await discoverSiotugaResources(this.context.municipalityCode!, this.context.planning!, scopedFetch)).catalog?.detailedPlanningLayer
      }
      if (!this.historicalLayer) throw new Error('No accredited PORD layer; TILEINDEX is not historical planning')
      layer = this.historicalLayer
    }
    const url = new URL(kind === 'modern' ? IGN : SIOTUGA)
    const b = args.bbox
    url.search = new URLSearchParams({ ...(kind === 'modern' ? {} : { codine: this.context.municipalityCode! }), SERVICE: 'WMS', VERSION: kind === 'legend' ? '1.1.1' : '1.3.0', REQUEST: kind === 'legend' ? 'GetLegendGraphic' : 'GetMap', ...(kind === 'legend' ? { LAYER: layer } : { LAYERS: layer, STYLES: kind === 'modern' ? 'default' : '', CRS: 'EPSG:4326', BBOX: `${b.minLat},${b.minLng},${b.maxLat},${b.maxLng}`, WIDTH: String(args.width), HEIGHT: String(args.height), TRANSPARENT: 'TRUE' }), FORMAT: 'image/png' }).toString()
    // Reuse immutable map bytes for repeat inspection within this turn.
    const existing = [...this.views.values()].find(view => view.metadata.sourceUrl === url.toString())
    if (existing) return existing
    const bytes = await this.request(url)
    const png = decodePng(bytes)
    if (!png || (kind !== 'legend' && (png.width !== args.width || png.height !== args.height))) throw new Error('Unsupported PNG or unexpected dimensions')
    return this.store(bytes, { kind, provenanceKind: 'official_wms_view', expedienteId: this.context.expedienteId, municipalityCode: this.context.municipalityCode!, instrumentId: this.context.instrumentId!, sourceUrl: url.toString(), layer, style: kind === 'modern' ? 'default' : '', wmsVersion: kind === 'legend' ? '1.1.1' : '1.3.0', crs: 'EPSG:4326', bbox: { ...b }, spatialFrameApplicable: kind !== 'legend', requestedDimensions: { width: args.width, height: args.height }, axisOrder: 'latitude,longitude', width: png.width, height: png.height, queriedAt: new Date().toISOString(), pixelConvention: 'top-left; x right; y down; pixel centres 0..width-1,0..height-1', parentViewIds: [] })
  }
  async execute(input: CartographicViewArguments): Promise<CartographicToolResult> {
    const result: CartographicToolResult = { toolName: 'get_cartographic_view', status: 'unavailable', views: [], limitations: [] }
    if (!this.context.municipalityCode || !this.context.instrumentId || !this.context.planning?.applicableInstruments?.some(instrument => instrument.status === 'current' && instrument.id === this.context.instrumentId)) {
      result.limitations.push('INPUT_NOT_AVAILABLE: municipio e instrumento vigentes no acreditados')
      return result
    }
    const args = parseCartographicArguments(input)
    if (!args) { result.status = 'error'; result.limitations.push('Invalid cartographic arguments'); return result }
    try {
      if (args.operation === 'acquire') {
        const kinds = args.representation === 'pair' ? ['historical', 'modern'] as const : [args.representation]
        for (const kind of kinds) {
          try { result.views.push((await this.acquire(kind, args)).metadata) }
          catch (error) { if (this.context.signal?.aborted) throw error; result.limitations.push(error instanceof Error ? error.message : 'Cartographic source unavailable') }
        }
      } else {
        const source = this.views.get(args.sourceViewId)
        const reference = this.views.get(args.referenceViewId)
        if (source?.metadata.kind !== 'historical' || reference?.metadata.kind !== 'modern') throw new Error('Unknown or incompatible turn-scoped source/reference views')
        const modern = await this.acquire('modern', args)
        const id = `cartographic-alignment:${hash(JSON.stringify({ sourceViewId: args.sourceViewId, referenceViewId: args.referenceViewId, transform: args.transform }))}`
        const bytes = renderCartographicAlignment({ ...source.metadata, bytes: source.bytes }, { ...reference.metadata, bytes: reference.bytes }, { ...modern.metadata, bytes: modern.bytes }, args.transform, args.opacity)
        const frozen = [...this.views.values()].some(view => view.metadata.alignment?.id === id && view.metadata.alignment.phase === 'freeze')
        const overlay = this.store(bytes, { ...modern.metadata, kind: 'overlay', provenanceKind: 'derived_alignment_overlay', sourceUrl: null, layer: null, style: null, wmsVersion: null, parentViewIds: [source.metadata.id, reference.metadata.id, modern.metadata.id], alignment: { id, phase: frozen ? 'freeze' : args.phase, sourceViewId: source.metadata.id, referenceViewId: reference.metadata.id, transform: structuredClone(args.transform), opacity: args.opacity } })
        result.views.push(modern.metadata, overlay.metadata)
      }
      result.status = result.views.length ? 'available' : 'unavailable'
      result.limitations.push('Representación oficial no acredita alineación ni ordenanza. IGN nofondo conserva sombreado. A es vista WMS, no georreferencia de un JPG/PDF original. Parcela no interviene en el ajuste.')
    } catch (error) {
      this.context.signal?.throwIfAborted()
      result.status = 'error'
      result.limitations.push(error instanceof Error ? error.message : 'Cartographic evidence unavailable')
    }
    return result
  }
}
