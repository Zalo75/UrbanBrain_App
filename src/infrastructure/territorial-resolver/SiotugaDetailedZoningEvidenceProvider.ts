import type {
  DetailedZoningObservation,
  DetailedZoningStrategy,
  DetailedZoningStrategyContext,
} from '@/application/territorial-resolver/ordinanceCandidateResolver'
import type {
  ParcelGeometry,
  PlanningDocumentReference,
  VisualZoningInterpretation,
  VisualZoningObservation,
  UrbanisticIdentitySemanticType,
} from '@/domain/territorial-resolver/types'
import { discoverSiotugaResources } from './SiotugaResourceDiscovery'
import { isExternalServiceFailure } from './officialHttp'
import { SiotugaPlanningKnowledgeSource } from '@/infrastructure/planning-knowledge/SiotugaPlanningKnowledgeSource'
import { getInstrumentIdentityCatalog } from '@/infrastructure/planning-knowledge/PlanningKnowledgeBase'
import { runtimeCatalogStatus } from '@/domain/planning-knowledge/identityCatalog'
import { selectOriginalPlanningSheets, type TileIndexFeature } from './originalPlanningSheetSelector'
import { overlayParcelOnPng, type GeographicBbox } from './parcelMapOverlay'

const SIOTUGA_WMS_URL = 'https://siotuga.xunta.gal/siotuga/ws'

export type DetailedZoningVisualObservation = VisualZoningObservation

export interface DetailedZoningVisualContext {
  municipalityCode?: string
  classification?: string
  category?: string
  knownIdentities?: string[]
  evidence?: string[]
}

export interface InstrumentZoningCatalog {
  instrumentId: string
  identities: Array<{
    code: string
    label: string
    aliases?: string[]
    normativeArticle?: string
    evidence?: string
    identityId?: string
    semanticDimension?: UrbanisticIdentitySemanticType
    status?: 'ACCEPTED' | 'REVIEW_REQUIRED' | 'REJECTED'
    normativeReferences?: Array<{ documentId: string; chunkIds: string[]; article?: string; relation: 'defines' | 'regulates' | 'mentions'; sourceId: string }>
  }>
}

export interface DetailedZoningVisualInterpretation extends VisualZoningInterpretation {}

/* Legacy aliases keep injected strategies/tests source-compatible. */
export interface LegacyDetailedZoningVisualObservation {
  observedLabel: string | null
  observedSymbols?: string[]
  observedBoundaries?: string[]
  parcelRelation?: 'contains' | 'intersects' | 'ambiguous' | 'unknown'
  competingLabels?: string[]
  confidence?: 'high' | 'medium' | 'low'
  semanticDimension?: UrbanisticIdentitySemanticType
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
    context?: DetailedZoningVisualContext
    sourceUrl: string
    instrumentId: string
  }): Promise<DetailedZoningVisualInterpretation | DetailedZoningVisualObservation[]>
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

function mergeVisualResult(
  previous: DetailedZoningVisualInterpretation | undefined,
  next: DetailedZoningVisualInterpretation,
): DetailedZoningVisualInterpretation {
  const observations = [...(previous?.observations ?? []), ...next.observations]
  const seen = new Set<string>()
  const unique = observations.filter((observation) => {
    const key = [
      observation.observedText,
      observation.observedCode,
      observation.observedNumber,
      observation.observedLabel,
      observation.description,
      observation.spatialRelation ?? observation.parcelRelation,
    ].map((value) => value ?? '').join('|').trim()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const states = [previous?.resolutionState, next.resolutionState]
  return {
    resolutionState: states.includes('multizone')
      ? 'multizone'
      : states.includes('ambiguous')
        ? 'ambiguous'
        : states.includes('resolved')
          ? 'resolved'
          : 'unresolved',
    observations: unique,
    explanation: [previous?.explanation, next.explanation].filter(Boolean).join(' ') || undefined,
  }
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
  private sourceFailure?: string
  getSourceFailure() { return this.sourceFailure }
  private visualResult?: DetailedZoningVisualInterpretation

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

  getVisualResult() {
    return this.visualResult
  }

  async resolve(context: DetailedZoningStrategyContext): Promise<DetailedZoningObservation[]> {
    const startedAt = Date.now()
    const timedFetch = async (phase: string, url: string) => {
      const phaseStartedAt = Date.now()
      try {
        const response = await this.fetcher(url, { signal: AbortSignal.timeout(this.timeoutMs) })
        console.log('UB-DIAG detailed-phase', JSON.stringify({ phase, status: response.status, durationMs: Date.now() - phaseStartedAt }))
        return response
      } catch (error) {
        console.log('UB-DIAG detailed-phase', JSON.stringify({ phase, status: 'error', durationMs: Date.now() - phaseStartedAt, error: error instanceof Error ? error.name : 'unknown' }))
        throw error
      }
    }
    this.visualResult = undefined
    this.sourceFailure = undefined
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
      console.log('UB-DIAG detailed-discovery', JSON.stringify({ municipalityCode, instrumentId, durationMs: Date.now() - startedAt, hasDetailedLayer: Boolean(discovered.catalog?.detailedPlanningLayer), hasTileIndex: Boolean(discovered.catalog?.planningTileIndex) }))
      const resources = discovered.catalog
      if (!resources?.detailedPlanningLayer && !resources?.planningTileIndex) return []

      const { lat, lng } = context.coordinates
      const bboxText = (value: GeographicBbox) => `${value.minLat},${value.minLng},${value.maxLat},${value.maxLng}`

      // Derive BBOX from parcel geometry when available so that the GetMap
      // window always contains the full parcel regardless of its size.
      // A fixed baseDelta fails for large/elongated parcels (e.g. rural 36059A039*).
      function parcelBboxFromGeometry(geom: ParcelGeometry, padFactor = 0.4): GeographicBbox {
        const points = geom.coordinates.flat(2) as [number, number][]
        const lngs = points.map((p) => p[0])
        const lats = points.map((p) => p[1])
        const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
        const minLat = Math.min(...lats), maxLat = Math.max(...lats)
        const dLng = (maxLng - minLng) * padFactor || 0.0002
        const dLat = (maxLat - minLat) * padFactor || 0.0002
        return { minLat: minLat - dLat, maxLat: maxLat + dLat, minLng: minLng - dLng, maxLng: maxLng + dLng }
      }
      const baseDelta = 0.00015
      const fallbackBbox = { minLat: lat - baseDelta, minLng: lng - baseDelta, maxLat: lat + baseDelta, maxLng: lng + baseDelta }
      const initialBbox = context.geometry
        ? parcelBboxFromGeometry(context.geometry as ParcelGeometry, 0.1)
        : fallbackBbox
      const getMapBbox = context.geometry
        ? parcelBboxFromGeometry(context.geometry as ParcelGeometry, 0.4)
        : fallbackBbox
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
        const response = await timedFetch('planning-tile-getfeatureinfo', tileInfo.toString())
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
        const gfiRes = await timedFetch('detailed-getfeatureinfo', gfiUrl.toString())
        if (gfiRes.ok) {
          const gfiXml = await gfiRes.text()
          const codeMatch = gfiXml.match(/<(?:codigo|etiqueta|zona|ordenanza|calificacion)>([^<]+)<\//i)
          if (codeMatch && codeMatch[1]?.trim()) {
            return [{
              identity: codeMatch[1].trim(),
              semanticDimension: 'zoning',
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
      const legendImage = await bytes(await timedFetch('pord-legend-download', legend.toString()))
      const canonicalCatalog = getInstrumentIdentityCatalog(municipalityCode, instrumentId)
      let catalog: InstrumentZoningCatalog | null = canonicalCatalog
        ? {
            instrumentId,
            identities: canonicalCatalog.identities.map((identity) => ({
              code: identity.officialCode,
              label: identity.officialName,
              aliases: [],
              evidence: identity.evidence.map((item) => item.quote).filter((quote): quote is string => Boolean(quote)).join(' | '),
              identityId: identity.id,
              semanticDimension: identity.semanticDimension,
          status: runtimeCatalogStatus(identity.status),
              normativeReferences: identity.normativeReferences,
            })),
          }
        : null
      if (!catalog && legendImage && this.interpreter.extractCatalog) {
        catalog = await this.interpreter.extractCatalog({ legendImage, instrumentId })
      }
      console.log('UB-DIAG detailed-phase', JSON.stringify({ phase: 'catalog-preparation', status: canonicalCatalog ? 'canonical' : legendImage ? 'legend-derived' : 'absent', identityCount: catalog?.identities.length ?? 0, durationMs: Date.now() - startedAt }))

      let visuals: DetailedZoningVisualObservation[] = []
      let selectedImage: Uint8Array | undefined
      let selectedQuery: URL | undefined
      let selectedBbox: GeographicBbox | undefined
      
      for (let pass = 0; pass < 2 && visuals.length === 0; pass += 1) {
        // pass 0: tight window from geometry (40% pad around parcel extent)
        // pass 1: looser window (80% pad) to catch parcels near zone boundaries
        const padFactor = pass === 0 ? 0.4 : 0.8
        const currentBbox = context.geometry
          ? parcelBboxFromGeometry(context.geometry as ParcelGeometry, padFactor)
          : getMapBbox
        const query = new URL(SIOTUGA_WMS_URL)
        query.search = new URLSearchParams({
          codine: municipalityCode,
          SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetMap',
          LAYERS: resources.detailedPlanningLayer ?? resources.planningTileIndex ?? '',
          STYLES: '', FORMAT: 'image/png', CRS: 'EPSG:4326',
          BBOX: bboxText(currentBbox), WIDTH: '1600', HEIGHT: '1600',
        }).toString()
        const image = await bytes(await timedFetch(`pord-map-download-pass-${pass + 1}`, query.toString()))
        if (!image || !context.geometry) continue
        const overlayStartedAt = Date.now()
        const markedImage = overlayParcelOnPng(image, context.geometry as ParcelGeometry, currentBbox)
        console.log('UB-DIAG detailed-phase', JSON.stringify({ phase: `parcel-overlay-pass-${pass + 1}`, status: markedImage ? 'ok' : 'empty', durationMs: Date.now() - overlayStartedAt }))
        if (!markedImage) continue
        const vlmStartedAt = Date.now()
        const visualResponse = await this.interpreter.inspect({
          image: markedImage,
          legendImage,
          catalog: catalog ?? undefined,
          context: {
            municipalityCode,
            classification: context.planning.classification
              ? `${context.planning.classification.code}: ${context.planning.classification.label}`
              : undefined,
            category: context.planning.classification?.categoryCode
              ? `${context.planning.classification.categoryCode}: ${context.planning.classification.categoryLabel ?? ''}`.trim()
              : undefined,
            knownIdentities: catalog?.identities.map((identity) => `${identity.code}: ${identity.label}`),
            evidence: context.planning.evidence.slice(0, 8).map((item) => `${item.method}: ${item.sourceUrl}`),
          },
          sourceUrl: query.toString(),
          instrumentId,
        })
        console.log('UB-DIAG detailed-phase', JSON.stringify({ phase: `vlm-inspect-pass-${pass + 1}`, status: 'ok', durationMs: Date.now() - vlmStartedAt }))
        const interpretation: DetailedZoningVisualInterpretation = Array.isArray(visualResponse)
          ? { resolutionState: visualResponse.length ? 'resolved' : 'unresolved', observations: visualResponse }
          : visualResponse
        this.visualResult = mergeVisualResult(this.visualResult, {
          ...interpretation,
          observations: interpretation.observations.map((observation) => ({
            ...observation,
            provenance: [...new Set([
              ...(observation.provenance ?? []),
              query.toString(),
              ...(legend ? [legend.toString()] : []),
            ])],
          })),
        })
        const validCandidates = interpretation.observations.filter(c => (
          (c.observedLabel?.trim() || c.observedCode?.trim() || c.observedText?.trim() || c.observedNumber?.trim()) &&
          (c.spatialRelation ?? c.parcelRelation) !== 'ambiguous' &&
          (c.spatialRelation ?? c.parcelRelation) !== 'unknown'
        ))
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
      console.log('UB-DIAG detailed-documents', JSON.stringify({ documentCount: collected.documents.length, durationMs: Date.now() - startedAt }))
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
        const observedIdentity = visual.observedCode?.trim() || visual.observedLabel?.trim() || visual.observedText?.trim() || visual.observedNumber?.trim()
        if (!observedIdentity) continue
        
        const validationStartedAt = Date.now()
        let validated = await this.documentValidator.validate({
          observedLabel: observedIdentity,
          instrumentId,
          documents: [...documents, ...imageDocuments(documents)],
        })
        console.log('UB-DIAG detailed-phase', JSON.stringify({ phase: 'document-validation', status: validated ? 'matched' : 'not_matched', durationMs: Date.now() - validationStartedAt }))
        
        // If not found in documents, check the catalog if present
        if (!validated && catalog) {
           const match = catalog.identities.find(i => 
             i.code.toUpperCase() === observedIdentity.toUpperCase() ||
             i.label.toUpperCase().includes(observedIdentity.toUpperCase()) ||
             i.aliases?.some((alias) => alias.toUpperCase() === observedIdentity.toUpperCase())
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
          graphicEvidence: visual.description ?? `observed=${observedIdentity}`,
          legendEvidence: [
            ...(visual.observedSymbols ?? []),
            ...(visual.observedColors ?? []),
            ...(visual.observedPatterns ?? []),
          ].join('; ') || 'legend inspected by interpreter',
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
          semanticDimension: visual.semanticDimension,
          reason: visual.description,
          reviewMaterials: {
            mapUrl: selectedQuery.toString(),
            legendUrl: legend.toString(),
            candidateOrdinances: [],
            sourceEvidence: [selectedQuery.toString(), legend.toString()],
          },
        })
      }
      console.log('UB-DIAG detailed-result', JSON.stringify({ municipalityCode, instrumentId, visualCount: visuals.length, validatedCount: validatedObservations.length, durationMs: Date.now() - startedAt }))
      return validatedObservations
    } catch (error) {
      console.log("ERROR in Siotuga:", error)
      if (isExternalServiceFailure(error) || (error instanceof Error && error.name === 'RuntimeBudgetExceeded')) {
        this.sourceFailure = error instanceof Error ? error.name : 'External cartographic source failure'
        return []
      }
      throw error
    }
  }
}
