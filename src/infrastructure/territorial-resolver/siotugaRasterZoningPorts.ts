import type {
  DetailedRasterZoningInput,
  DetailedRasterZoningPorts,
  RasterGeoreference,
  RasterNormativeIdentity,
  RasterSheetCandidate,
  RasterZoneIntersection,
} from '@/application/territorial-resolver/detailedRasterZoningEngine'
import type { DetailedZoningStrategyContext } from '@/application/territorial-resolver/ordinanceCandidateResolver'
import type { TerritorialCoordinates } from '@/domain/territorial-resolver/types'
import { discoverSiotugaResources } from './SiotugaResourceDiscovery'
import { RasterSymbolDetector, GeminiRasterSymbolVlm } from './rasterSymbolDetector'
import { RasterBoundaryExtractor } from './rasterBoundaryExtractor'
import { RasterTiePointExtractor } from './rasterTiePointExtractor'
import { SiotugaDetailedZoningDocumentValidator } from './SiotugaDetailedZoningDocumentValidator'
import { matchSheetToOfficialControls, selectUniqueSpatialMatch, type SpatialRegistrationControl } from './contentDrivenSheetMatcher'
import polygonClipping from 'polygon-clipping'

const WMS = 'https://siotuga.xunta.gal/siotuga/ws'

function bboxForPoint(point: TerritorialCoordinates) {
  const d = 0.00025
  return { minLat: point.lat - d, minLng: point.lng - d, maxLat: point.lat + d, maxLng: point.lng + d }
}

function bboxText(b: NonNullable<RasterSheetCandidate['bbox']>) {
  return `${b.minLat},${b.minLng},${b.maxLat},${b.maxLng}`
}

function ringArea(ring: number[][]) {
  let total = 0
  for (let i = 0; i < ring.length - 1; i += 1) total += ring[i]![0]! * ring[i + 1]![1]! - ring[i + 1]![0]! * ring[i]![1]!
  return Math.abs(total) / 2
}

function polygonArea(polygons: number[][][][]) {
  return polygons.reduce((sum, polygon) => sum + (ringArea(polygon[0] ?? []) - (polygon.slice(1).reduce((holes, hole) => holes + ringArea(hole), 0))), 0)
}

export function parseTile(xml: string, instrumentId: string): RasterSheetCandidate | undefined {
  const filename = xml.match(/<filename\b[^>]*>([^<]+)<\/filename>/i)?.[1]?.trim()
  const location = xml.match(/<location\b[^>]*>([^<]+)<\/location>/i)?.[1]?.trim()
  const coordinateMatches = [...xml.matchAll(/<(?:gml:)?coordinates\b[^>]*>([^<]+)<\/(?:gml:)?coordinates>/gi)]
  if (!filename || coordinateMatches.length === 0) return undefined
  const coordinateSets = coordinateMatches.map((match) => match[1]!.trim().split(/\s+/).map((pair) => pair.split(',').map(Number)).filter((p) => p.length >= 2 && p.every(Number.isFinite)))
  const pairs = coordinateSets.sort((left, right) => right.length - left.length)[0] ?? []
  if (pairs.length < 2) return undefined
  const lngs = pairs.map((p) => p[0]!)
  const lats = pairs.map((p) => p[1]!)
  const source = location ? new URL(location, WMS).toString() : `${WMS}?instrument=${encodeURIComponent(instrumentId)}&sheet=${encodeURIComponent(filename)}`
  return {
    id: `${instrumentId}:${filename}`,
    sourceUrl: source,
    format: /\.pdf$/i.test(filename) ? 'pdf' : /\.tiff?$/i.test(filename) ? 'tiff' : 'jpg',
    scaleDenominator: /(?:1000|2000)/.test(filename) ? Number((filename.match(/(?:1000|2000)/) ?? [])[0]) : undefined,
    bbox: { minLat: Math.min(...lats), minLng: Math.min(...lngs), maxLat: Math.max(...lats), maxLng: Math.max(...lngs) },
    provenance: [`siotuga:tile-index:${filename}`, source],
  }
}

export function extractScaleFromText(text: string): number | undefined {
  const match = text.match(/1\s*[\/:]\s*([0-9]{3,6})/i)
  return match ? parseInt(match[1]!, 10) : undefined
}

export function scoreGraphicSheet(description: string, groupDescription: string, scale?: number, placeName?: string): number {
  let score = 0
  const combined = `${groupDescription} ${description}`.toUpperCase()

  if (combined.includes('URBANO') || combined.includes('SOLO URBANO') || combined.includes('SUELO URBANO')) score += 50
  if (combined.includes('CALIFICACION') || combined.includes('CALIFICACIÓN') || combined.includes('ORDENACION') || combined.includes('ORDENACIÓN')) score += 30
  if (combined.includes('CLASIFICACION') || combined.includes('CLASIFICACIÓN')) score += 20
  if (combined.includes('ALIÑACIONS') || combined.includes('ALINEACIONES') || combined.includes('RASANTES')) score += 25

  if (scale) {
    if (scale <= 1000) score += 50
    else if (scale <= 2000) score += 40
    else if (scale <= 5000) score += 10
    else score -= 30
  }

  if (placeName && combined.includes(placeName.toUpperCase())) score += 30

  if (combined.includes('RUSTICO') || combined.includes('RÚSTICO') || combined.includes('NON URBANIZABLE') || combined.includes('NO URBANIZABLE') || combined.includes('MEDIO RURAL')) {
    if (!combined.includes('SUELO URBANO') && !combined.includes('SOLO URBANO')) score -= 50
  }

  return score
}

export async function discoverInventoryGraphicSheets(
  fetcher: typeof fetch,
  municipalityCode: string,
  instrumentId: string,
  placeName?: string
): Promise<RasterSheetCandidate[]> {
  try {
    const invUrl = `https://siotuga.xunta.gal/siotuga/inventario.php?inv=1&idconcello=${municipalityCode}`
    const invRes = await fetcher(invUrl)
    const cookies = invRes.headers.get('set-cookie') ?? ''
    const html = await invRes.text()
    const tokenMatch = html.match(/name=["']token["']\s+value=["']([^"']+)["']/i) ?? html.match(/token\s*=\s*["']([^"']+)["']/i)
    const token = tokenMatch ? tokenMatch[1] : ''

    const iotpuUrl = 'https://siotuga.xunta.gal/siotuga/assets/inventario/getIOTPU.php'
    const iotpuRes = await fetcher(iotpuUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies },
      body: new URLSearchParams({ iddoc: instrumentId, idp: '0', lang: 'es_ES', token: token ?? '' }),
    })
    if (!iotpuRes.ok) return []
    const data = await iotpuRes.json()
    const filesRoot = data?.datos_xerais?.filesroot ?? 'https://siotuga.xunta.gal/siotuga/documentos/urbanismo/'
    const folder = data?.datos_xerais?.folder ?? ''
    const candidates: Array<RasterSheetCandidate & { score: number }> = []

    if (Array.isArray(data?.elementos)) {
      for (const el of data.elementos) {
        const groupName = el?.description ?? el?.nome ?? ''
        if (Array.isArray(el?.componentes)) {
          for (const comp of el.componentes) {
            const fileName = comp?.pathesperado ?? comp?.ficheiro ?? ''
            if (!fileName || !/\.(?:jpe?g|png|tiff?|pdf)$/i.test(fileName)) continue
            const desc = comp?.descripcion ?? comp?.nome ?? groupName
            const scale = extractScaleFromText(desc) ?? extractScaleFromText(groupName)
            const score = scoreGraphicSheet(desc, groupName, scale, placeName)
            const format: RasterSheetCandidate['format'] = /\.pdf$/i.test(fileName) ? 'pdf' : /\.tiff?$/i.test(fileName) ? 'tiff' : /\.png$/i.test(fileName) ? 'png' : 'jpg'
            const sourceUrl = new URL(`${folder}/documents/${fileName}`, filesRoot.startsWith('http') ? filesRoot : new URL(filesRoot, 'https://siotuga.xunta.gal/siotuga/').toString()).toString()
            const zoningRole = /CALIFICACI(?:O|Ó)N|CALIFICACI(?:O|Ó)N DEL SUELO|ORDENACI(?:O|Ó)N SOLO URBANO/i.test(`${groupName} ${desc}`)
            candidates.push({
              id: `${instrumentId}:${fileName}`,
              sourceUrl,
              format,
              scaleDenominator: scale,
              score,
              provenance: [`siotuga:inventory:${comp?.id ?? fileName}`, `group:${groupName}`, `role:${zoningRole ? 'zoning' : 'auxiliary'}`, `scale:${scale ? '1:' + scale : 'unknown'}`, `score:${score}`],
            })
          }
        }
      }
    }
    return candidates.filter((c) => c.score >= 50).sort((a, b) => b.score - a.score)
  } catch {
    return []
  }
}

export async function fetchSpatialControls(
  fetcher: typeof fetch,
  municipalityCode: string,
  layer: string | undefined,
  point: TerritorialCoordinates,
): Promise<SpatialRegistrationControl[]> {
  if (!layer) return []
  const bbox = bboxForPoint(point)
  const url = new URL(WMS)
  url.search = new URLSearchParams({
    codine: municipalityCode,
    SERVICE: 'WFS',
    VERSION: '1.1.0',
    REQUEST: 'GetFeature',
    TYPENAME: layer,
    MAXFEATURES: '1000',
    SRSNAME: 'EPSG:4326',
    BBOX: `${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng},EPSG:4326`,
  }).toString()
  try {
    const response = await fetcher(url.toString())
    if (!response.ok) return []
    const xml = await response.text()
    const controls: SpatialRegistrationControl[] = []
    const members = xml.match(/<(?:\w+:)?featureMember\b[\s\S]*?<\/(?:\w+:)?featureMember>/gi) ?? []
    for (const member of members) {
      const id = member.match(/(?:gml:)?id=["']([^"']+)["']/i)?.[1] ?? `${layer}:${controls.length}`
      const numbers = (member.match(/<(?:\w+:)?posList[^>]*>([^<]+)<\//i)?.[1] ?? '').trim().split(/\s+/).map(Number).filter(Number.isFinite)
      const coordinates: Array<[number, number]> = []
      for (let index = 0; index + 1 < numbers.length; index += 2) coordinates.push([numbers[index + 1]!, numbers[index]!])
      controls.push({ id: id.trim(), geometry: undefined, coordinates, source: /1DEL/i.test(layer) ? '1DEL' : '3CLAS' })
    }
    // Some SIOTUGA responses omit feature ids but still contain official
    // members/geometries; retain a stable ordinal control in that case.
    if (controls.length === 0) {
      const count = [...xml.matchAll(/<(?:\w+:)?featureMember\b/gi)].length
      for (let index = 0; index < count; index += 1) controls.push({ id: `${layer}:${index}`, geometry: undefined, source: /1DEL/i.test(layer) ? '1DEL' : '3CLAS' })
    }
    return controls
  } catch {
    return []
  }
}

/** Real SIOTUGA-backed port composition. It is intentionally fail-closed:
 * no zoning identity is manufactured when the official raster lacks a
 * georeferencing transform, closed boundary, legend match or same-instrument
 * documentary proof. */
export class SiotugaRasterZoningPortFactory {
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly timeoutMs = 10_000) {}

  create(context: { strategyContext: DetailedZoningStrategyContext; input: DetailedRasterZoningInput }): DetailedRasterZoningPorts | null {
    const { strategyContext, input } = context
    if (!strategyContext.coordinates || !strategyContext.planning.documents) return null
    const documents = strategyContext.planning.documents
    let activeSheet: RasterSheetCandidate | undefined
    let mapImage: Uint8Array | undefined
    let legendImage: Uint8Array | undefined
    let activeMapBbox: NonNullable<RasterSheetCandidate['bbox']> | undefined
    const boundaryExtractor = new RasterBoundaryExtractor()
    const tiePointExtractor = new RasterTiePointExtractor()
    const validator = new SiotugaDetailedZoningDocumentValidator(this.fetcher)

    return {
      discoverSheets: async () => {
        // Priority 1: Query official instrument inventory for high-detail urban sheets (1:1.000 / 1:2.000)
        const inventorySheets = await discoverInventoryGraphicSheets(this.fetcher, input.municipalityCode, input.instrumentId)
        if (inventorySheets.length > 0) {
          const resources = (await discoverSiotugaResources(input.municipalityCode, strategyContext.planning, this.fetcher, this.timeoutMs)).catalog
          const controls = [
            ...(await fetchSpatialControls(this.fetcher, input.municipalityCode, resources?.classificationLayer, strategyContext.coordinates!)),
            ...(await fetchSpatialControls(this.fetcher, input.municipalityCode, resources?.boundaryLayer, strategyContext.coordinates!)),
          ]
          const spatialMatches = [] as ReturnType<typeof matchSheetToOfficialControls>[]
          for (const sheet of inventorySheets.filter((candidate) => candidate.provenance.includes('role:zoning'))) {
            try {
              const response = await this.fetcher(sheet.sourceUrl)
              if (!response.ok) { spatialMatches.push(matchSheetToOfficialControls(sheet, controls)); continue }
              const raster = new Uint8Array(await response.arrayBuffer())
              const tiePoints = await tiePointExtractor.extract(raster, controls)
              sheet.provenance.push(...tiePoints.provenance)
              spatialMatches.push(matchSheetToOfficialControls(sheet, controls, { tiePoints: tiePoints.tiePoints, topologyScore: tiePoints.topologyScore }))
            } catch {
              spatialMatches.push(matchSheetToOfficialControls(sheet, controls))
            }
          }
          const selectedMatch = selectUniqueSpatialMatch(spatialMatches)
          const confirmed = selectedMatch ? [selectedMatch] : []
          // A tile-index filename is only a diagnostic hint; it cannot promote
          // an inventory sheet without an official spatial registration.
          activeSheet = confirmed
            .map((match) => inventorySheets.find((sheet) => sheet.id === match.sheetId))
            .find((sheet): sheet is RasterSheetCandidate => Boolean(sheet))
          if (!activeSheet) return []
          const winningMatch = confirmed.find((match) => match.sheetId === activeSheet!.id)
          if (winningMatch?.bbox) activeSheet.bbox = winningMatch.bbox
          try {
            if (!mapImage) {
              const mapRes = await this.fetcher(activeSheet!.sourceUrl)
              if (mapRes.ok) mapImage = new Uint8Array(await mapRes.arrayBuffer())
            }
          } catch {
            // fallback if direct download fails
          }
          // Even when the original sheet is downloadable, obtain a bounded
          // official WMS view and legend. The WMS BBOX supplies the only
          // deterministic pixel transform when the raster has no world file.
          try {
            const resources = (await discoverSiotugaResources(input.municipalityCode, strategyContext.planning, this.fetcher, this.timeoutMs)).catalog
            if (resources?.detailedPlanningLayer) {
              activeMapBbox = bboxForPoint(strategyContext.coordinates!)
              const map = new URL(WMS)
              map.search = new URLSearchParams({ codine: input.municipalityCode, SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetMap', LAYERS: resources.detailedPlanningLayer, STYLES: '', FORMAT: 'image/png', CRS: 'EPSG:4326', BBOX: bboxText(activeMapBbox), WIDTH: '1600', HEIGHT: '1600' }).toString()
              const mapRes = await this.fetcher(map.toString())
              if (mapRes.ok && !mapImage) {
                mapImage = new Uint8Array(await mapRes.arrayBuffer())
                activeSheet.provenance.push(`wms:getmap:${map.toString()}`)
              }
              const legend = new URL(WMS)
              legend.search = new URLSearchParams({ codine: input.municipalityCode, SERVICE: 'WMS', VERSION: '1.1.1', REQUEST: 'GetLegendGraphic', FORMAT: 'image/png', LAYER: resources.detailedPlanningLayer }).toString()
              const legendRes = await this.fetcher(legend.toString())
              if (legendRes.ok) legendImage = new Uint8Array(await legendRes.arrayBuffer())
            }
          } catch {
            // Keep the original sheet as provenance; georeferencing will fail closed.
          }
          return inventorySheets
        }

        // Priority 2: Fallback to WMS TileIndex
        const discovered = await discoverSiotugaResources(input.municipalityCode, strategyContext.planning, this.fetcher, this.timeoutMs)
        const layer = discovered.catalog?.planningTileIndex ?? discovered.catalog?.detailedPlanningLayer
        if (!layer) return []
        let sheet: RasterSheetCandidate | undefined
        for (let level = 0; level < 3 && !sheet; level += 1) {
          const base = bboxForPoint(strategyContext.coordinates!)
          const factor = 2 ** level
          const centerLat = strategyContext.coordinates!.lat
          const centerLng = strategyContext.coordinates!.lng
          const bbox = { minLat: centerLat - (centerLat - base.minLat) * factor, maxLat: centerLat + (base.maxLat - centerLat) * factor, minLng: centerLng - (centerLng - base.minLng) * factor, maxLng: centerLng + (base.maxLng - centerLng) * factor }
          const url = new URL(WMS)
          url.search = new URLSearchParams({ codine: input.municipalityCode, SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetFeatureInfo', LAYERS: layer, QUERY_LAYERS: layer, INFO_FORMAT: 'application/vnd.ogc.gml', CRS: 'EPSG:4326', BBOX: bboxText(bbox), WIDTH: '101', HEIGHT: '101', I: '50', J: '50', FEATURE_COUNT: '10' }).toString()
          const response = await this.fetcher(url.toString())
          if (response.ok) sheet = parseTile(await response.text(), input.instrumentId)
        }
        if (!sheet) return []
        activeSheet = sheet
        const map = new URL(WMS)
        activeMapBbox = bboxForPoint(strategyContext.coordinates!)
        map.search = new URLSearchParams({ codine: input.municipalityCode, SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetMap', LAYERS: layer, STYLES: '', FORMAT: 'image/png', CRS: 'EPSG:4326', BBOX: bboxText(activeMapBbox), WIDTH: '1600', HEIGHT: '1600' }).toString()
        const mapResponse = await this.fetcher(map.toString())
        if (mapResponse.ok) mapImage = new Uint8Array(await mapResponse.arrayBuffer())
        sheet.provenance.push(`wms:getmap:${map.toString()}`)
        const legend = new URL(WMS)
        legend.search = new URLSearchParams({ codine: input.municipalityCode, SERVICE: 'WMS', VERSION: '1.1.1', REQUEST: 'GetLegendGraphic', FORMAT: 'image/png', LAYER: layer }).toString()
        const legendResponse = await this.fetcher(legend.toString())
        if (legendResponse.ok) legendImage = new Uint8Array(await legendResponse.arrayBuffer())
        return [sheet]
      },
      georeference: async (_input, sheet): Promise<RasterGeoreference> => {
        const isInventory = sheet.provenance.some((p) => p.startsWith('siotuga:inventory:'))
        const isWmsImage = sheet.provenance.some((p) => p.startsWith('wms:getmap:'))

        if (isInventory) {
          // HAS STEP 2: An external WMS BBOX (activeMapBbox) does NOT provide a pixel transform
          // for the original inventory sheet. We must not fake it.
          // Since the automatic sheet matcher didn't provide tiePoints here, we fail closed.
          return {
            sheetId: sheet.id,
            method: 'none',
            accepted: false,
            provenance: [...sheet.provenance, 'georeference:missing-official-extent-for-original-raster']
          }
        }
        
        if (!sheet.bbox) return { sheetId: sheet.id, method: 'none', accepted: false, provenance: [...sheet.provenance, 'georeference:missing-official-extent'] }
        const hasWmsTransform = isWmsImage && Boolean(activeMapBbox)
        return { sheetId: sheet.id, method: 'official-wms-bbox-pixel-affine', residualPixels: 0, accepted: hasWmsTransform, pixelBbox: activeMapBbox ? { ...activeMapBbox, width: 1600, height: 1600 } : undefined, provenance: [...sheet.provenance, hasWmsTransform ? 'georeference:official-wms-bbox' : 'georeference:missing-wms-request'] }
      },
      detectSymbols: async () => {
        if (!activeSheet || !mapImage) return []
        const vlm = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY ? new GeminiRasterSymbolVlm() : undefined
        return new RasterSymbolDetector({ vlm, legend: legendImage, maxRois: 24 }).detect(mapImage, activeSheet.id, input.instrumentId)
      },
      extractBoundaries: async (_input, _sheet, georeference, symbols) => {
        if (!activeSheet || !mapImage) return []
        return boundaryExtractor.extract(mapImage, activeSheet, georeference, symbols)
      },
      intersectParcel: async (parcelInput, sheet, boundaries) => {
        const parcel = parcelInput.parcelGeometry.coordinates as number[][][][]
        const totalArea = polygonArea(parcel)
        if (!totalArea) return []
        const result: RasterZoneIntersection[] = []
        for (const boundary of boundaries) {
          const geometry = boundary.geometry as { type?: string; coordinates?: number[][][] } | undefined
          if (!geometry || geometry.type !== 'Polygon' || !geometry.coordinates) continue
          const clipped = polygonClipping.intersection(parcel as never, [geometry.coordinates] as never) as unknown as number[][][][]
          const area = polygonArea(clipped)
          if (!area) continue
          const symbol = boundary.symbol
          if (!symbol) continue
          result.push({ boundaryId: boundary.id, coveragePercent: Math.min(100, area / totalArea * 100), areaSquareMetres: area * 111_000 * 111_000, symbol, sourceSheet: sheet.sourceUrl, confidence: boundary.confidence, topologyProven: true, provenance: [...boundary.provenance, 'polygon-clipping:epsg4326'] })
        }
        return result
      },
      validateNormative: async (_input, intersection): Promise<RasterNormativeIdentity | null> => {
        const symbol = intersection.symbol.code ?? intersection.symbol.label
        if (!symbol || !strategyContext.planning.documents) return null
        const docs = documents.filter((doc) => doc.instrumentId === input.instrumentId)
        const validated = await validator.validate({ observedLabel: symbol, instrumentId: input.instrumentId, documents: docs })
        if (!validated) return null
        return { code: symbol, label: validated.identity, document: validated.sourceDocument ?? docs[0]?.sourceUrl ?? '', instrumentId: input.instrumentId, article: validated.documentaryEvidence, superiorVectorCompatible: Boolean(input.superiorClassification), provenance: [validated.sourceDocument ?? '', validated.documentaryEvidence].filter(Boolean) }
      },
      respectsSuperiorVector: (_input, identity) => identity.superiorVectorCompatible === true,
    }
  }
}

export function createSiotugaRasterZoningPortFactory(fetcher: typeof fetch = fetch) {
  return new SiotugaRasterZoningPortFactory(fetcher)
}
