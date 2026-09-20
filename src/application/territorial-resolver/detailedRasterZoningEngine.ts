import type { ParcelGeometry, TerritorialConfidence } from '@/domain/territorial-resolver/types'
import type { DetailedZoningStrategy, DetailedZoningStrategyContext, DetailedZoningObservation } from './ordinanceCandidateResolver'

export type DetailedRasterZoningStatus = 'AUTO_CONFIRMED' | 'REVIEW_REQUIRED' | 'NOT_DETERMINED'

export interface RasterSheetCandidate {
  id: string
  sourceUrl: string
  format: 'jpg' | 'jpeg' | 'png' | 'tiff' | 'pdf'
  scaleDenominator?: number
  bbox?: { minLat: number; minLng: number; maxLat: number; maxLng: number }
  provenance: string[]
}

export interface RasterGeoreference {
  sheetId: string
  method: string
  residualMetres?: number
  residualPixels?: number
  accepted: boolean
  pixelBbox?: { minLat: number; minLng: number; maxLat: number; maxLng: number; width: number; height: number }
  provenance: string[]
}

export interface RasterSymbolObservation {
  code?: string
  label?: string
  bbox?: [number, number, number, number]
  position?: { lat: number; lng: number }
  confidence: TerritorialConfidence
  sourceSymbol: string
  rawEvidence?: string
  /** True only when the code/label is present in the official legend. */
  legendMatch?: boolean
  provenance: string[]
}

export type RasterBoundaryKind = 'zoning' | 'topographic' | 'parcel' | 'road' | 'unknown'

export interface RasterBoundary {
  id: string
  kind: RasterBoundaryKind
  closed: boolean
  geometry?: unknown
  symbol?: RasterSymbolObservation
  /** Topological closure/intersection was proven by the geometry adapter. */
  topologyProven?: boolean
  confidence: TerritorialConfidence
  provenance: string[]
}

export interface RasterZoneIntersection {
  boundaryId: string
  coveragePercent: number
  areaSquareMetres?: number
  symbol: RasterSymbolObservation
  sourceSheet: string
  confidence: TerritorialConfidence
  topologyProven?: boolean
  provenance: string[]
}

export interface RasterNormativeIdentity {
  code: string
  label: string
  ordinance?: string
  article?: string
  document: string
  instrumentId: string
  /** Compatibility with the superior 3CLAS/1DEL restriction. */
  superiorVectorCompatible?: boolean
  provenance: string[]
}

export interface DetailedRasterZoningZone {
  code: string
  label: string
  ordinance?: string
  coveragePercent: number
  sourceSheet: string
  sourceSymbol: string
  normativeArticle?: string
  confidence: TerritorialConfidence
  provenance: string[]
}

export interface DetailedZoningResolution {
  status: DetailedRasterZoningStatus
  zones: DetailedRasterZoningZone[]
  reason?: string
  gateFailures?: string[]
  provenance: string[]
  hasEligibility?: {
    eligible: true
    reason: 'OFFICIAL_RASTER_WITHOUT_USABLE_SPATIAL_REFERENCE'
    municipalityCode: string
    instrumentId: string
    parcelGeometry: ParcelGeometry
    sheet: {
      id: string
      sourceUrl: string
      format: RasterSheetCandidate['format']
      provenance: string[]
    }
  }
}

export interface DetailedRasterZoningInput {
  municipalityCode: string
  instrumentId: string
  parcelGeometry: ParcelGeometry
  superiorClassification?: { classificationCode?: string; categoryCode?: string }
}

export interface DetailedRasterZoningPorts {
  discoverSheets(input: DetailedRasterZoningInput): Promise<RasterSheetCandidate[]>
  georeference(input: DetailedRasterZoningInput, sheet: RasterSheetCandidate): Promise<RasterGeoreference>
  detectSymbols(input: DetailedRasterZoningInput, sheet: RasterSheetCandidate, georeference: RasterGeoreference): Promise<RasterSymbolObservation[]>
  extractBoundaries(input: DetailedRasterZoningInput, sheet: RasterSheetCandidate, georeference: RasterGeoreference, symbols: RasterSymbolObservation[]): Promise<RasterBoundary[]>
  intersectParcel(input: DetailedRasterZoningInput, sheet: RasterSheetCandidate, boundaries: RasterBoundary[]): Promise<RasterZoneIntersection[]>
  validateNormative(input: DetailedRasterZoningInput, intersection: RasterZoneIntersection): Promise<RasterNormativeIdentity | null>
  respectsSuperiorVector?(input: DetailedRasterZoningInput, identity: RasterNormativeIdentity): boolean
}

function scaleRank(sheet: RasterSheetCandidate) {
  return sheet.scaleDenominator ?? Number.POSITIVE_INFINITY
}

function mergeProvenance(...values: string[][]) {
  return [...new Set(values.flat().filter(Boolean))]
}

/**
 * Conservative orchestration for historical raster plans. It deliberately
 * keeps image interpretation behind ports and only promotes a result when
 * georeferencing, zoning geometry, parcel intersection and same-instrument
 * documentary validation all converge.
 */
export class DetailedRasterZoningEngine {
  constructor(
    private readonly ports: DetailedRasterZoningPorts,
    private readonly options: { maxScaleDenominator?: number; materialCoveragePercent?: number } = {},
  ) {}

  async resolve(input: DetailedRasterZoningInput): Promise<DetailedZoningResolution> {
    const sheets = (await this.ports.discoverSheets(input))
      .filter((sheet) => !this.options.maxScaleDenominator || !sheet.scaleDenominator || sheet.scaleDenominator <= this.options.maxScaleDenominator)
      .sort((left, right) => scaleRank(left) - scaleRank(right))
    if (sheets.length === 0) return { status: 'REVIEW_REQUIRED', zones: [], reason: 'NO_USABLE_DETAIL_SHEET', provenance: [] }

    let reviewProvenance: string[] = []
    let hasEligibility: DetailedZoningResolution['hasEligibility'] = undefined

    for (const sheet of sheets) {
      const georeference = await this.ports.georeference(input, sheet)
      const baseProvenance = mergeProvenance(sheet.provenance, georeference.provenance)
      reviewProvenance = mergeProvenance(reviewProvenance, baseProvenance)
      if (!georeference.accepted) {
        if (!hasEligibility) {
          hasEligibility = {
            eligible: true,
            reason: 'OFFICIAL_RASTER_WITHOUT_USABLE_SPATIAL_REFERENCE',
            municipalityCode: input.municipalityCode,
            instrumentId: input.instrumentId,
            parcelGeometry: input.parcelGeometry,
            sheet: {
              id: sheet.id,
              sourceUrl: sheet.sourceUrl,
              format: sheet.format,
              provenance: [...sheet.provenance],
            }
          }
        }
        continue
      }

      const symbols = await this.ports.detectSymbols(input, sheet, georeference)
      const boundaries = (await this.ports.extractBoundaries(input, sheet, georeference, symbols))
        .filter((boundary) => boundary.kind === 'zoning' && boundary.closed && boundary.confidence !== 'low')
      if (boundaries.length === 0) continue

      const intersections = (await this.ports.intersectParcel(input, sheet, boundaries))
        .filter((intersection) => Number.isFinite(intersection.coveragePercent) && intersection.coveragePercent > 0)
      if (intersections.length === 0) continue

      const validated: DetailedRasterZoningZone[] = []
      const gateFailures = new Set<string>()
      for (const intersection of intersections) {
        const identity = await this.ports.validateNormative(input, intersection)
        if (!identity || identity.instrumentId !== input.instrumentId) continue
        if (this.ports.respectsSuperiorVector && !this.ports.respectsSuperiorVector(input, identity)) gateFailures.add('SUPERIOR_VECTOR_INCOMPATIBLE')
        if (identity.superiorVectorCompatible !== true) gateFailures.add('SUPERIOR_VECTOR_UNCONFIRMED')
        if (intersection.symbol.legendMatch !== true) gateFailures.add('LEGEND_SYMBOL_UNCONFIRMED')
        if (intersection.topologyProven === false) gateFailures.add('TOPOLOGY_UNPROVEN')
        const code = identity.code.trim()
        const label = identity.label.trim()
        if (!code || !label) continue
        validated.push({
          code,
          label,
          ordinance: identity.ordinance,
          coveragePercent: intersection.coveragePercent,
          sourceSheet: sheet.sourceUrl,
          sourceSymbol: intersection.symbol.sourceSymbol,
          normativeArticle: identity.article,
          confidence: intersection.confidence,
          provenance: mergeProvenance(baseProvenance, intersection.provenance, identity.provenance),
        })
      }
      const deduped = [...new Map(validated.map((zone) => [`${zone.code}|${zone.ordinance ?? ''}`, zone])).values()]
      if (deduped.length === 0) continue
      const material = deduped.filter((zone) => zone.coveragePercent >= (this.options.materialCoveragePercent ?? 1))
      const status: DetailedRasterZoningStatus = material.length > 1 || gateFailures.size > 0 ? 'REVIEW_REQUIRED' : 'AUTO_CONFIRMED'
      return {
        status,
        zones: deduped,
        gateFailures: [...gateFailures],
        reason: gateFailures.size > 0 ? 'DETERMINISTIC_CONVERGENCE_GATE_FAILED' : undefined,
        provenance: mergeProvenance(...deduped.map((zone) => zone.provenance)),
      }
    }
    return { status: 'REVIEW_REQUIRED', zones: [], reason: 'RASTER_EVIDENCE_INSUFFICIENT', provenance: reviewProvenance, hasEligibility }
  }
}

/** Adapts the raster engine to the existing vector/GetFeatureInfo cascade. */
export class DetailedRasterZoningStrategyAdapter implements DetailedZoningStrategy {
  readonly id = 'detailed-raster-zoning-v1'
  private lastHasEligibility?: DetailedZoningResolution['hasEligibility']

  constructor(
    private readonly engine: DetailedRasterZoningEngine,
    private readonly geometryForContext: (context: DetailedZoningStrategyContext) => ParcelGeometry | null,
    private readonly portsInput: (context: DetailedZoningStrategyContext) => Omit<DetailedRasterZoningInput, 'parcelGeometry' | 'municipalityCode'>,
  ) {}

  async resolve(context: DetailedZoningStrategyContext): Promise<DetailedZoningObservation[]> {
    const geometry = this.geometryForContext(context)
    const municipalityCode = context.municipalityCode
    if (!geometry || !municipalityCode) return []
    const input = { ...this.portsInput(context), municipalityCode, parcelGeometry: geometry }
    const resolution = await this.engine.resolve(input)
    this.lastHasEligibility = resolution.hasEligibility
    return resolution.zones.map((zone) => ({
      identity: zone.ordinance ?? zone.code,
      semanticDimension: 'ordinance',
      instrumentId: input.instrumentId,
      sourceRef: zone.sourceSheet,
      sourceDocument: zone.sourceSheet,
      spatialEvidence: `coverage=${zone.coveragePercent}%`,
      graphicEvidence: zone.sourceSymbol,
      legendEvidence: zone.sourceSymbol,
      documentaryEvidence: zone.normativeArticle ?? zone.label,
      instrumentMembership: resolution.status !== 'NOT_DETERMINED',
      provenance: zone.provenance,
      coverage: { type: resolution.zones.length > 1 ? 'partial' : 'full', percentage: zone.coveragePercent },
      confidence: zone.confidence,
    }))
  }

  getHasEligibilitySignal() {
    return this.lastHasEligibility
  }
}
