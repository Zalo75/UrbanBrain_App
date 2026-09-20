import { describe, expect, it } from 'vitest'
import type { ParcelGeometry } from '@/domain/territorial-resolver/types'
import { DetailedRasterZoningEngine, type DetailedRasterZoningPorts } from './detailedRasterZoningEngine'

const geometry: ParcelGeometry = { type: 'MultiPolygon', crs: 'EPSG:4326', coordinates: [] }

function ports(overrides: Partial<DetailedRasterZoningPorts> = {}): DetailedRasterZoningPorts {
  const sheet = { id: 'sheet-1', sourceUrl: 'official://sheet-1', format: 'jpg' as const, scaleDenominator: 1000, provenance: ['inventory:sheet-1'] }
  const symbol = { code: 'O2', label: 'Ordenanza 2', sourceSymbol: 'circle:O2', confidence: 'high' as const, legendMatch: true, provenance: ['visual:O2'] }
  return {
    discoverSheets: async () => [sheet],
    georeference: async () => ({ sheetId: sheet.id, method: '3CLAS/1DEL control points', residualPixels: 1, accepted: true, provenance: ['geo:1'] }),
    detectSymbols: async () => [symbol],
    extractBoundaries: async () => [{ id: 'boundary-1', kind: 'zoning', closed: true, confidence: 'high' as const, symbol, provenance: ['boundary:1'] }],
    intersectParcel: async () => [{ boundaryId: 'boundary-1', coveragePercent: 100, symbol, sourceSheet: sheet.id, confidence: 'high' as const, topologyProven: true, provenance: ['intersection:1'] }],
    validateNormative: async (input, intersection) => ({ code: intersection.symbol.code!, label: intersection.symbol.label!, ordinance: intersection.symbol.label, article: 'Art. 58', document: 'normativa.pdf', instrumentId: input.instrumentId, superiorVectorCompatible: true, provenance: ['normative:58'] }),
    ...overrides,
  }
}

describe('DetailedRasterZoningEngine V1', () => {
  it('auto-confirms one same-instrument zoning identity with full provenance', async () => {
    const result = await new DetailedRasterZoningEngine(ports()).resolve({ municipalityCode: 'x', instrumentId: '23045', parcelGeometry: geometry })
    expect(result.status).toBe('AUTO_CONFIRMED')
    expect(result.zones).toMatchObject([{ code: 'O2', coveragePercent: 100, normativeArticle: 'Art. 58' }])
    expect(result.provenance).toEqual(expect.arrayContaining(['inventory:sheet-1', 'geo:1', 'normative:58']))
  })

  it('preserves material multizone evidence and never selects a dominant zone', async () => {
    const base = ports({
      intersectParcel: async () => {
        const a = { code: 'O1', label: 'Ordenanza 1', sourceSymbol: 'O1', confidence: 'high' as const, legendMatch: true, provenance: ['visual:O1'] }
        const b = { code: 'O2', label: 'Ordenanza 2', sourceSymbol: 'O2', confidence: 'high' as const, legendMatch: true, provenance: ['visual:O2'] }
        return [
          { boundaryId: 'a', coveragePercent: 70, symbol: a, sourceSheet: 'sheet-1', confidence: 'high' as const, topologyProven: true, provenance: [] },
          { boundaryId: 'b', coveragePercent: 30, symbol: b, sourceSheet: 'sheet-1', confidence: 'high' as const, topologyProven: true, provenance: [] },
        ]
      },
        validateNormative: async (input, intersection) => ({ code: intersection.symbol.code!, label: intersection.symbol.label!, instrumentId: input.instrumentId, document: 'normativa.pdf', superiorVectorCompatible: true, provenance: [] }),
    })
    const result = await new DetailedRasterZoningEngine(base).resolve({ municipalityCode: 'x', instrumentId: '23045', parcelGeometry: geometry })
    expect(result.status).toBe('REVIEW_REQUIRED')
    expect(result.zones.map((zone) => zone.code)).toEqual(['O1', 'O2'])
  })

  it('fails closed for insufficient scale, unsafe georeferencing, open/topographic boundaries and wrong-instrument documents', async () => {
    const scale = await new DetailedRasterZoningEngine(ports(), { maxScaleDenominator: 2000 }).resolve({ municipalityCode: 'x', instrumentId: '23045', parcelGeometry: geometry })
    expect(scale.status).toBe('AUTO_CONFIRMED')
    const tooCoarse = await new DetailedRasterZoningEngine(ports({ discoverSheets: async () => [{ id: 'coarse', sourceUrl: 'official://coarse', format: 'jpg', scaleDenominator: 5000, provenance: [] }] }), { maxScaleDenominator: 2000 }).resolve({ municipalityCode: 'x', instrumentId: '23045', parcelGeometry: geometry })
    expect(tooCoarse).toMatchObject({ status: 'REVIEW_REQUIRED', reason: 'NO_USABLE_DETAIL_SHEET' })
    const unsafe = await new DetailedRasterZoningEngine(ports({ georeference: async () => ({ sheetId: 'sheet-1', method: 'bad', residualPixels: 20, accepted: false, provenance: [] }) })).resolve({ municipalityCode: 'x', instrumentId: '23045', parcelGeometry: geometry })
    expect(unsafe.status).toBe('REVIEW_REQUIRED')
    const open = await new DetailedRasterZoningEngine(ports({ extractBoundaries: async () => [{ id: 'x', kind: 'topographic', closed: false, confidence: 'high', provenance: [] }] })).resolve({ municipalityCode: 'x', instrumentId: '23045', parcelGeometry: geometry })
    expect(open.status).toBe('REVIEW_REQUIRED')
    const wrongInstrument = await new DetailedRasterZoningEngine(ports({ validateNormative: async () => ({ code: 'O2', label: 'Ordenanza 2', instrumentId: 'other', document: 'other.pdf', provenance: [] }) })).resolve({ municipalityCode: 'x', instrumentId: '23045', parcelGeometry: geometry })
    expect(wrongInstrument.status).toBe('REVIEW_REQUIRED')
  })

  it('requires all deterministic convergence gates before AUTO_CONFIRMED', async () => {
    const noLegend = ports({
      detectSymbols: async () => [{ code: 'O2', label: 'Ordenanza 2', sourceSymbol: 'O2', confidence: 'high', legendMatch: false, provenance: [] }],
      intersectParcel: async () => [{ boundaryId: 'boundary-1', coveragePercent: 100, symbol: { code: 'O2', label: 'Ordenanza 2', sourceSymbol: 'O2', confidence: 'high', legendMatch: false, provenance: [] }, sourceSheet: 'sheet-1', confidence: 'high', topologyProven: true, provenance: [] }],
    })
    const legendResult = await new DetailedRasterZoningEngine(noLegend).resolve({ municipalityCode: 'x', instrumentId: '23045', parcelGeometry: geometry })
    expect(legendResult.status).toBe('REVIEW_REQUIRED')
    expect(legendResult.gateFailures).toContain('LEGEND_SYMBOL_UNCONFIRMED')

    const noTopology = ports({
      intersectParcel: async () => [{ boundaryId: 'boundary-1', coveragePercent: 100, symbol: { code: 'O2', label: 'Ordenanza 2', sourceSymbol: 'O2', confidence: 'high', legendMatch: true, provenance: [] }, sourceSheet: 'sheet-1', confidence: 'high', topologyProven: false, provenance: [] }],
    })
    const topologyResult = await new DetailedRasterZoningEngine(noTopology).resolve({ municipalityCode: 'x', instrumentId: '23045', parcelGeometry: geometry })
    expect(topologyResult.status).toBe('REVIEW_REQUIRED')
    expect(topologyResult.gateFailures).toContain('TOPOLOGY_UNPROVEN')
  })

  it('emits HAS eligibility when an official raster lacks an accepted spatial reference', async () => {
    // A) hoja oficial concreta + georef rechazada + parcela canónica => HAS elegible
    const noGeoref = ports({
      georeference: async (input, sheet) => ({ sheetId: sheet.id, method: 'none', accepted: false, provenance: [] })
    })
    const result = await new DetailedRasterZoningEngine(noGeoref).resolve({ municipalityCode: 'm1', instrumentId: 'i1', parcelGeometry: geometry })
    expect(result.status).toBe('REVIEW_REQUIRED')
    expect(result.hasEligibility).toMatchObject({
      eligible: true,
      reason: 'OFFICIAL_RASTER_WITHOUT_USABLE_SPATIAL_REFERENCE',
      municipalityCode: 'm1',
      instrumentId: 'i1',
      sheet: { id: 'sheet-1' }
    })
  })

  it('does NOT emit HAS eligibility if the raster was successfully georeferenced', async () => {
    // B) hoja oficial concreta + georef aceptada => NO requiere fallback HAS
    const result = await new DetailedRasterZoningEngine(ports()).resolve({ municipalityCode: 'x', instrumentId: '23045', parcelGeometry: geometry })
    expect(result.status).toBe('AUTO_CONFIRMED')
    expect(result.hasEligibility).toBeUndefined()
  })

  it('does NOT emit HAS eligibility if no concrete raster exists at all', async () => {
    // C) no existe hoja/raster concreto => HAS NO elegible
    // D) REVIEW_REQUIRED genérico sin raster concreto => HAS NO elegible
    const noSheets = ports({
      discoverSheets: async () => []
    })
    const result = await new DetailedRasterZoningEngine(noSheets).resolve({ municipalityCode: 'x', instrumentId: '23045', parcelGeometry: geometry })
    expect(result.status).toBe('REVIEW_REQUIRED')
    expect(result.reason).toBe('NO_USABLE_DETAIL_SHEET')
    expect(result.hasEligibility).toBeUndefined()
  })
})
