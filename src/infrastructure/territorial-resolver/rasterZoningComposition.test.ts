import { describe, expect, it } from 'vitest'
import { createDetailedRasterZoningStrategy } from './rasterZoningComposition'
import type { DetailedRasterZoningPorts } from '@/application/territorial-resolver/detailedRasterZoningEngine'
import { resolveOrdinanceCandidatesDetailed } from '@/application/territorial-resolver/ordinanceCandidateResolver'

const geometry = { type: 'MultiPolygon' as const, crs: 'EPSG:4326' as const, coordinates: [] }

function ports(): DetailedRasterZoningPorts {
  const symbol = { code: 'O1', label: 'Ordenanza 1', sourceSymbol: 'O1', legendMatch: true, confidence: 'high' as const, provenance: ['legend:1'] }
  return {
    discoverSheets: async () => [{ id: 'sheet', sourceUrl: 'official://sheet', format: 'jpg', scaleDenominator: 1000, provenance: ['sheet:1'] }],
    georeference: async () => ({ sheetId: 'sheet', method: 'control-points', accepted: true, provenance: ['geo:1'] }),
    detectSymbols: async () => [symbol],
    extractBoundaries: async () => [{ id: 'b', kind: 'zoning', closed: true, topologyProven: true, confidence: 'high', symbol, provenance: ['boundary:1'] }],
    intersectParcel: async () => [{ boundaryId: 'b', coveragePercent: 100, topologyProven: true, symbol, sourceSheet: 'sheet', confidence: 'high', provenance: ['intersection:1'] }],
    validateNormative: async (input) => ({ code: 'O1', label: 'Ordenanza 1', ordinance: 'Ordenanza 1', article: 'Art. 57', document: '23045.pdf', instrumentId: input.instrumentId, superiorVectorCompatible: true, provenance: ['article:57'] }),
  }
}

function unreferencedOfficialRasterPorts(): DetailedRasterZoningPorts {
  return {
    discoverSheets: async () => [{
      id: '23045:1002su001.jpg',
      sourceUrl: 'https://official.example/23045/1002su001.jpg',
      format: 'jpg',
      scaleDenominator: 2000,
      provenance: ['siotuga:inventory:1002su001.jpg', 'role:zoning'],
    }],
    georeference: async () => ({
      sheetId: '23045:1002su001.jpg',
      method: 'none',
      accepted: false,
      provenance: ['georeference:missing-official-extent-for-original-raster'],
    }),
    detectSymbols: async () => [],
    extractBoundaries: async () => [],
    intersectParcel: async () => [],
    validateNormative: async () => null,
  }
}

describe('raster composition root', () => {
  it('builds the runtime strategy from injected official ports', async () => {
    const strategy = createDetailedRasterZoningStrategy({ create: () => ports() })
    const result = await strategy.resolve({
      municipalityCode: '36059',
      geometry,
      planning: { status: 'determined', applicableInstruments: [{ id: '23045', name: 'NNSS', kind: 'general', status: 'current' }], classification: { code: 'SU', categoryCode: 'SUSC', label: 'Suelo urbano' } } as never,
    })
    expect(result).toMatchObject([{ identity: 'Ordenanza 1', instrumentId: '23045', coverage: { percentage: 100 } }])
  })

  it('fails closed when the composition root has no complete port set', async () => {
    const strategy = createDetailedRasterZoningStrategy({ create: () => null })
    const result = await strategy.resolve({ municipalityCode: '36059', geometry, planning: { applicableInstruments: [{ id: '23045', status: 'current' }] } } as never)
    expect(result).toEqual([])
  })

  it('propagates an official unreferenced raster signal through the runtime strategy and ordinance resolution', async () => {
    const strategy = createDetailedRasterZoningStrategy({ create: () => unreferencedOfficialRasterPorts() })
    const planning = {
      status: 'determined' as const,
      instrument: 'Normas Subsidiarias de Planeamiento',
      applicableInstruments: [{ id: '23045', name: 'Normas Subsidiarias de Planeamiento', kind: 'general' as const, status: 'current' as const }],
      evidence: [],
      warnings: [],
    }

    const resolution = await resolveOrdinanceCandidatesDetailed(planning, {
      municipalityCode: '36059',
      geometry,
      strategies: [strategy],
    })

    expect(resolution.metadata.hasEligibility).toMatchObject({
      eligible: true,
      reason: 'OFFICIAL_RASTER_WITHOUT_USABLE_SPATIAL_REFERENCE',
      municipalityCode: '36059',
      instrumentId: '23045',
      parcelGeometry: geometry,
      sheet: {
        id: '23045:1002su001.jpg',
        sourceUrl: 'https://official.example/23045/1002su001.jpg',
      },
    })
  })

  it('clears a previous signal when a later resolution is not eligible', async () => {
    let available = true
    const strategy = createDetailedRasterZoningStrategy({
      create: () => available ? unreferencedOfficialRasterPorts() : null,
    })
    const context = {
      municipalityCode: '36059',
      geometry,
      planning: { applicableInstruments: [{ id: '23045', status: 'current' }] },
    } as never

    await strategy.resolve(context)
    expect(strategy.getHasEligibilitySignal?.()).toMatchObject({ eligible: true })

    available = false
    await strategy.resolve(context)
    expect(strategy.getHasEligibilitySignal?.()).toBeUndefined()
  })
})
