import type {
  DetailedZoningObservation,
  DetailedZoningStrategy,
  DetailedZoningStrategyContext,
} from '@/application/territorial-resolver/ordinanceCandidateResolver'
import type { ParcelGeometry, PlanningDocumentReference } from '@/domain/territorial-resolver/types'
import { discoverSiotugaResources } from './SiotugaResourceDiscovery'
import { isExternalServiceFailure } from './officialHttp'
import { SiotugaPlanningKnowledgeSource } from '@/infrastructure/planning-knowledge/SiotugaPlanningKnowledgeSource'
import { selectOriginalPlanningSheets, type TileIndexFeature } from './originalPlanningSheetSelector'
import { overlayParcelOnPng, type GeographicBbox } from './parcelMapOverlay'

const SIOTUGA_WMS_URL = 'https://siotuga.xunta.gal/siotuga/ws'

export interface DetailedZoningVisualObservation {
  observedLabel: string | null
  observedSymbols?: string[]
  observedBoundaries?: string[]
  parcelRelation?: 'contains' | 'intersects' | 'ambiguous' | 'unknown'
  competingLabels?: string[]
  confidence?: 'high' | 'medium' | 'low'
}

export interface InstrumentZoningCatalog {
  instrumentId: string
  identities: Array<{
    code: string
    label: string
    aliases?: string[]
    normativeArticle?: string
    evidence?: string
  }>
}

export interface DetailedZoningVisualInterpreter {
  extractCatalog?(input: {
    legendImage: Uint8Array
    instrumentId: string
  }): Promise<InstrumentZoningCatalog | null>

  inspect(input: {
    image: Uint8Array
    legendImage?: Uint8Array
    catalog?: InstrumentZoningCatalog
    sourceUrl: string
    instrumentId: string
  }): Promise<DetailedZoningVisualObservation[]>
}

export interface DetailedZoningDocumentValidator {
  validate(input: {
    observedLabel: string
    instrumentId: string
    documents: PlanningDocumentReference[]
  }): Promise<{
    identity: string
    sourceDocument?: string
    documentaryEvidence: string
  } | null>
}

export interface SiotugaDetailedZoningEvidenceProviderOptions {
  fetcher?: typeof fetch
  interpreter?: DetailedZoningVisualInterpreter
  documentValidator?: DetailedZoningDocumentValidator
  timeoutMs?: number
}

function currentInstrumentId(context: DetailedZoningStrategyContext) {
  return context.planning.applicableInstruments?.find((item) => item.status === 'current')?.id
}

function imageDocuments(documents: PlanningDocumentReference[]) {
  return documents.filter((document) =>
    /\.(?:png|jpe?g|tiff?|pdf)$/i.test(document.sourceUrl) ||
    /(?:sheet|plano|calific|ordenaci[oó]n)/i.test(document.title)
  )
}

async function bytes(response: Response) {
  if (!response.ok) return undefined
  return new Uint8Array(await response.arrayBuffer())
}

function tileFeature(xml: string, instrumentId: string): TileIndexFeature | undefined {
  const coordinateMatch = xml.match(/<gml:coordinates>([^<]+)<\/gml:coordinates>/i)
  if (!coordinateMatch) return undefined
  const pairs = coordinateMatch[1]!.trim().split(/\s+/).map((pair) => pair.split(',').map(Number))
  const valid = pairs.filter((pair) => pair.length >= 2 && pair.every(Number.isFinite))
  if (valid.length < 3) return undefined
  const lngs = valid.map((pair) => pair[0]!)
  const lats = valid.map((pair) => pair[1]!)
  const value = (tag: string) => xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`, 'i'))?.[1]?.trim()
  return {
    instrumentId,
    gid: value('gid'),
    filename: value('filename'),
    location: value('location'),
    folder: value('folder'),
    extent: { minLat: Math.min(...lats), minLng: Math.min(...lngs), maxLat: Math.max(...lats), maxLng: Math.max(...lngs) },
  }
}

/**
 * Official SIOTUGA source bridge. It never turns pixels into an effective
 * ordinance itself: the replaceable interpreter observes a label and the
 * replaceable document validator proves its meaning in the same instrument.
 */
export class SiotugaDetailedZoningEvidenceProvider implements DetailedZoningStrategy {
  readonly id = 'siotuga-detailed-zoning'

  private readonly fetcher: typeof fetch
  private readonly interpreter?: DetailedZoningVisualInterpreter
  private readonly documentValidator?: DetailedZoningDocumentValidator
  private readonly timeoutMs: number

  constructor(options: SiotugaDetailedZoningEvidenceProviderOptions = {}) {
    this.fetcher = options.fetcher ?? fetch
    this.interpreter = options.interpreter
    this.documentValidator = options.documentValidator
    this.timeoutMs = options.timeoutMs ?? 10_000
  }

  async resolve(context: DetailedZoningStrategyContext): Promise<DetailedZoningObservation[]> {
    const instrumentId = currentInstrumentId(context)
    const municipalityCode = context.municipalityCode
    if (!instrumentId || !municipalityCode || !context.coordinates || !this.interpreter || !this.documentValidator) {
      return []
    }

    try {
      const discovered = await discoverSiotugaResources(
        municipalityCode,
        context.planning,
        this.fetcher,
        this.timeoutMs,
      )
      const resources = discovered.catalog
      if (!resources?.detailedPlanningLayer && !resources?.planningTileIndex) return []

      const { lat, lng } = context.coordinates
      const baseDelta = 0.00015
      const bboxForLevel = (level: number) => {
        const delta = baseDelta / 2 ** level
        return { minLat: lat - delta, minLng: lng - delta, maxLat: lat + delta, maxLng: lng + delta }
      }
      const bboxText = (value: GeographicBbox) => `${value.minLat},${value.minLng},${value.maxLat},${value.maxLng}`
      const initialBbox = bboxForLevel(0)
      let tile: TileIndexFeature | undefined
      if (resources.planningTileIndex) {
        const tileInfo = new URL(SIOTUGA_WMS_URL)
        tileInfo.search = new URLSearchParams({
          codine: municipalityCode,
          SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetFeatureInfo',
          LAYERS: resources.planningTileIndex, QUERY_LAYERS: resources.planningTileIndex,
          INFO_FORMAT: 'application/vnd.ogc.gml', CRS: 'EPSG:4326',
          BBOX: bboxText(initialBbox), WIDTH: '101', HEIGHT: '101', I: '50', J: '50', FEATURE_COUNT: '10',
        }).toString()
        const response = await this.fetcher(tileInfo.toString())
        if (response.ok) tile = tileFeature(await response.text(), instrumentId)
      }
      // FASE 1: GetFeatureInfo on detailedPlanningLayer
      if (resources.detailedPlanningLayer) {
        const gfiUrl = new URL(SIOTUGA_WMS_URL)
        gfiUrl.search = new URLSearchParams({
          codine: municipalityCode,
          SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetFeatureInfo',
          LAYERS: resources.detailedPlanningLayer, QUERY_LAYERS: resources.detailedPlanningLayer,
          INFO_FORMAT: 'application/vnd.ogc.gml', CRS: 'EPSG:4326',
          BBOX: bboxText(initialBbox), WIDTH: '101', HEIGHT: '101', I: '50', J: '50', FEATURE_COUNT: '10',
        }).toString()
        const gfiRes = await this.fetcher(gfiUrl.toString())
        if (gfiRes.ok) {
          const gfiXml = await gfiRes.text()
          const codeMatch = gfiXml.match(/<(?:codigo|etiqueta|zona|ordenanza|calificacion)>([^<]+)<\//i)
          if (codeMatch && codeMatch[1]?.trim()) {
            return [{
              identity: codeMatch[1].trim(),
              instrumentId,
              sourceRef: gfiUrl.toString(),
              spatialEvidence: `GetFeatureInfo on ${resources.detailedPlanningLayer}`,
              graphicEvidence: 'N/A',
              legendEvidence: 'N/A',
              documentaryEvidence: 'Validated via vector features',
              instrumentMembership: true,
              provenance: [gfiUrl.toString()],
              confidence: 'high'
            }]
          }
        }
      }

      const legend = new URL(SIOTUGA_WMS_URL)
      legend.search = new URLSearchParams({
        codine: municipalityCode,
        SERVICE: 'WMS',
        VERSION: '1.1.1',
        REQUEST: 'GetLegendGraphic',
        FORMAT: 'image/png',
        LAYER: resources.detailedPlanningLayer ?? resources.planningTileIndex ?? '',
      }).toString()
      const legendImage = await bytes(await this.fetcher(legend.toString()))
      
      let catalog: InstrumentZoningCatalog | null = null
      if (legendImage && this.interpreter.extractCatalog) {
        catalog = await this.interpreter.extractCatalog({ legendImage, instrumentId })
      }

      let visuals: DetailedZoningVisualObservation[] = []
      let selectedImage: Uint8Array | undefined
      let selectedQuery: URL | undefined
      let selectedBbox: GeographicBbox | undefined
      
      for (let level = 0; level < 3 && visuals.length === 0; level += 1) {
        const currentBbox = bboxForLevel(level)
        const query = new URL(SIOTUGA_WMS_URL)
        query.search = new URLSearchParams({
          codine: municipalityCode,
          SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetMap',
          LAYERS: resources.detailedPlanningLayer ?? resources.planningTileIndex ?? '',
          STYLES: '', FORMAT: 'image/png', CRS: 'EPSG:4326',
          BBOX: bboxText(currentBbox), WIDTH: '1600', HEIGHT: '1600',
        }).toString()
        const image = await bytes(await this.fetcher(query.toString()))
        if (!image || !context.geometry) continue
        const markedImage = overlayParcelOnPng(image, context.geometry as ParcelGeometry, currentBbox)
        if (!markedImage) continue
        const candidates = await this.interpreter.inspect({
          image: markedImage,
          legendImage,
          catalog: catalog ?? undefined,
          sourceUrl: query.toString(),
          instrumentId,
        })
        const validCandidates = candidates.filter(c => c.observedLabel?.trim() && c.parcelRelation !== 'ambiguous' && c.parcelRelation !== 'unknown')
        if (validCandidates.length > 0) {
          visuals = validCandidates
          selectedImage = markedImage
          selectedQuery = query
          selectedBbox = currentBbox
        }
      }
      
      if (visuals.length === 0 || !selectedImage || !selectedQuery || !selectedBbox) return []

      const collected = await new SiotugaPlanningKnowledgeSource(this.fetcher).collectInstrumentDocuments(
        municipalityCode,
        instrumentId,
        new Date().toISOString(),
      )
      const documents = collected.documents
        .filter((document) => document.instrumentId === instrumentId)
        .map((document) => ({
          id: document.officialDocumentId,
          instrumentId: document.instrumentId,
          title: document.name,
          sourceUrl: document.officialUrl,
          binding: 'general' as const,
          documentType: document.documentType,
        }))
      const originalSheets = tile
        ? selectOriginalPlanningSheets({ feature: tile, documents, point: context.coordinates })
        : []
        
      const validatedObservations: DetailedZoningObservation[] = []
      for (const visual of visuals) {
        if (!visual.observedLabel) continue
        
        let validated = await this.documentValidator.validate({
          observedLabel: visual.observedLabel,
          instrumentId,
          documents: [...documents, ...imageDocuments(documents)],
        })
        
        // If not found in documents, check the catalog if present
        if (!validated && catalog) {
           const match = catalog.identities.find(i => 
             i.code.toUpperCase() === visual.observedLabel!.toUpperCase() || 
             i.label.toUpperCase().includes(visual.observedLabel!.toUpperCase())
           )
           if (match) {
             validated = {
               identity: match.code,
               documentaryEvidence: match.evidence ?? 'Validated via instrument catalog',
             }
           }
        }
        
        if (!validated) continue
        
        validatedObservations.push({
          identity: validated.identity,
          instrumentId,
          sourceRef: selectedQuery.toString(),
          sourceDocument: validated.sourceDocument,
          spatialEvidence: `SIOTUGA WMS ${resources.detailedPlanningLayer ?? resources.planningTileIndex}; BBOX ${bboxText(selectedBbox)}; parcel overlay applied`,
          graphicEvidence: `observedLabel=${visual.observedLabel}`,
          legendEvidence: visual.observedSymbols?.join('; ') ?? 'legend inspected by interpreter',
          documentaryEvidence: validated.documentaryEvidence,
          instrumentMembership: true,
          provenance: [
            selectedQuery.toString(),
            legend.toString(),
            ...(tile?.filename ? [`tile:${tile.filename}`] : []),
            ...originalSheets.map((sheet) => sheet.document.sourceUrl),
            validated.sourceDocument ?? collected.rawSource.id,
          ],
          confidence: visual.confidence ?? 'medium',
        })
      }
      return validatedObservations
    } catch (error) {
      console.log("ERROR in Siotuga:", error)
      if (isExternalServiceFailure(error)) {
        return []
      }
      throw error
    }
  }
}
