import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { RasterSymbolDetector, type RasterSymbolVlm } from './rasterSymbolDetector'
import { RasterBoundaryExtractor } from './rasterBoundaryExtractor'
import { ParcelZoningClassifier } from '@/application/territorial-resolver/parcelZoningClassifier'

async function image() {
  return sharp({ create: { width: 80, height: 60, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
    .composite([{ input: { create: { width: 16, height: 10, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }, left: 20, top: 20 }])
    .png().toBuffer()
}

describe('real raster providers', () => {
  it('detects compact ROIs and sends only ROI plus legend to the VLM', async () => {
    const calls: { roi: number; legend?: number }[] = []
    const vlm: RasterSymbolVlm = { interpret: async (request) => { calls.push({ roi: request.roi.byteLength, legend: request.legend?.byteLength }); return { code: 'O2', label: 'Ordenanza 2', confidence: 'high', rawEvidence: 'legend-code' } } }
    const detector = new RasterSymbolDetector({ vlm, legend: new Uint8Array([1, 2, 3]), maxRois: 2 })
    const result = await detector.detect(await image(), 'sheet', '23045')
    expect(result.length).toBeGreaterThan(0)
    expect(result[0]).toMatchObject({ code: 'O2', legendMatch: true, confidence: 'high' })
    expect(calls[0].legend).toBe(3)
  })

  it('fails closed when no semantic provider is configured', async () => {
    const result = await new RasterSymbolDetector().detect(await image(), 'sheet', '23045')
    expect(result.every((symbol) => !symbol.code && !symbol.label && symbol.confidence === 'low')).toBe(true)
  })

  it('keeps only closed, continuous zoning candidates with acceptable stroke width', async () => {
    const extractor = new RasterBoundaryExtractor({ candidateDetector: async () => [
      { id: 'zone', kind: 'zoning', closed: true, strokeWidthPx: 2, continuity: 0.95, confidence: 'high', geometry: { type: 'Polygon' } },
      { id: 'contour', kind: 'topographic', closed: true, strokeWidthPx: 2, continuity: 0.95, confidence: 'high' },
      { id: 'open', kind: 'zoning', closed: false, strokeWidthPx: 2, continuity: 0.95, confidence: 'high' },
      { id: 'thick', kind: 'zoning', closed: true, strokeWidthPx: 20, continuity: 0.99, confidence: 'high' },
    ] })
    const result = await extractor.extract(new Uint8Array([1]), { id: 's', sourceUrl: 'official://s', format: 'jpg', provenance: [] }, { sheetId: 's', method: 'control-points', accepted: true, provenance: [] }, [])
    expect(result.map((boundary) => boundary.id)).toEqual(['zone'])
    expect(result[0]).toMatchObject({ topologyProven: true, kind: 'zoning' })
  })

  it('preserves material multi-zone coverage instead of selecting a dominant polygon', async () => {
    const classifier = new ParcelZoningClassifier({ intersect: async (_parcel, boundary) => ({ coveragePercent: boundary.id === 'a' ? 60 : 40, topologyProven: true }) })
    const symbolA = { code: 'O1', label: 'Ordenanza 1', sourceSymbol: 'O1', confidence: 'high' as const, legendMatch: true, provenance: [] }
    const symbolB = { code: 'O2', label: 'Ordenanza 2', sourceSymbol: 'O2', confidence: 'high' as const, legendMatch: true, provenance: [] }
    const result = await classifier.classify({ municipalityCode: 'x', instrumentId: 'i', parcelGeometry: { type: 'MultiPolygon', crs: 'EPSG:4326', coordinates: [] } }, [
      { id: 'a', kind: 'zoning', closed: true, topologyProven: true, confidence: 'high', symbol: symbolA, provenance: [] },
      { id: 'b', kind: 'zoning', closed: true, topologyProven: true, confidence: 'high', symbol: symbolB, provenance: [] },
    ], [symbolA, symbolB], 'sheet')
    expect(result.map((item) => item.coveragePercent)).toEqual([60, 40])
    expect(result).toHaveLength(2)
  })
})
