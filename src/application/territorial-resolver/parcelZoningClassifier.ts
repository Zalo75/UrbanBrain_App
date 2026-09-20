import type { RasterBoundary, RasterZoneIntersection, DetailedRasterZoningInput, RasterSymbolObservation } from './detailedRasterZoningEngine'

export interface ParcelBoundaryIntersectionAdapter {
  intersect(parcel: DetailedRasterZoningInput['parcelGeometry'], boundary: RasterBoundary): Promise<{ coveragePercent: number; areaSquareMetres?: number; topologyProven: boolean } | null>
}

/** Geometry-only classifier. It does not choose a dominant zone. */
export class ParcelZoningClassifier {
  constructor(private readonly adapter: ParcelBoundaryIntersectionAdapter) {}

  async classify(input: DetailedRasterZoningInput, boundaries: RasterBoundary[], symbols: RasterSymbolObservation[], sourceSheet: string): Promise<RasterZoneIntersection[]> {
    const result: RasterZoneIntersection[] = []
    for (const boundary of boundaries) {
      if (boundary.kind !== 'zoning' || !boundary.closed || !boundary.symbol) continue
      const symbol = symbols.find((candidate) => candidate === boundary.symbol || candidate.code === boundary.symbol?.code || candidate.label === boundary.symbol?.label) ?? boundary.symbol
      const intersection = await this.adapter.intersect(input.parcelGeometry, boundary)
      if (!intersection || !Number.isFinite(intersection.coveragePercent) || intersection.coveragePercent <= 0) continue
      result.push({
        boundaryId: boundary.id,
        coveragePercent: Math.max(0, Math.min(100, intersection.coveragePercent)),
        areaSquareMetres: intersection.areaSquareMetres,
        symbol,
        sourceSheet,
        confidence: boundary.confidence,
        topologyProven: intersection.topologyProven,
        provenance: [...boundary.provenance, `parcel-intersection:${intersection.coveragePercent}`],
      })
    }
    return result
  }
}
