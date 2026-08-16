import { describe, it, expect } from 'vitest'
import { SiotugaClassificationAdapter } from './SiotugaClassificationAdapter'
import type { PlanningApplicability, PlanningPort, TerritorialCoordinates, ParcelGeometry } from '@/domain/territorial-resolver/types'
import { getSiotugaClassificationLayer } from './SiotugaClassificationRegistry'

function feature(
  id: string,
  classification: string,
  category: string,
  ring: Array<[number, number]>
) {
  const positions = ring.map(([lng, lat]) => `${lat} ${lng}`).join(' ')
  return `<gml:featureMember><ms:classification gml:id="${id}"><ms:geom><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>${positions}</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></ms:geom><ms:cla_homo>${classification}</ms:cla_homo><ms:cat_homo>${category}</ms:cat_homo></ms:classification></gml:featureMember>`
}

function fixtureFetcher(...features: string[]) {
  return async () => new Response(
    `<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs" xmlns:gml="http://www.opengis.net/gml" xmlns:ms="http://mapserver.gis.umn.edu/mapserver">${features.join('')}</wfs:FeatureCollection>`,
    { status: 200, headers: { 'content-type': 'application/xml' } }
  )
}

class MockFallback implements PlanningPort {
  async findApplicablePlanning(location: { municipalityCode?: string }): Promise<PlanningApplicability> {
    const layer = location.municipalityCode ? getSiotugaClassificationLayer(location.municipalityCode) : undefined;
    return {
      status: 'determined',
      instrument: layer?.instrument.name ?? 'Mock Instrument',
      approvalDate: layer?.instrument.approvalDate ?? '2000-01-01',
      sourceUrl: layer?.instrument.inventoryUrl ?? 'https://mock',
      applicableInstruments: layer ? [{
        id: layer.instrument.siotugaDocumentId,
        name: layer.instrument.name,
        kind: 'general',
        status: 'current',
        approvalDate: layer.instrument.approvalDate,
        sourceUrl: layer.instrument.inventoryUrl,
      }] : [],
      canAnswerConcreteParameters: true,
      evidence: [],
      warnings: [],
    }
  }
}

describe('Implicit Background Classification (Ames)', () => {
  it('should resolve implicit background correctly for Ames (100% background)', async () => {
    const adapter = new SiotugaClassificationAdapter(new MockFallback(), fixtureFetcher())
    // 15002A076002700000ZO geometry is in a rural area of Ames (no SNR/SU polygon)
    const location = {
      municipalityCode: '15002',
      coordinates: { lat: 42.871, lng: -8.665 } as TerritorialCoordinates,
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [-8.6650, 42.8710],
              [-8.6649, 42.8710],
              [-8.6649, 42.8711],
              [-8.6650, 42.8711],
              [-8.6650, 42.8710]
            ]
          ]
        ],
        crs: 'EPSG:4326'
      } as ParcelGeometry
    }

    const result = await adapter.findApplicablePlanning(location)
    expect(result.classificationResolution).toBeDefined()
    const res = result.classificationResolution!

    // Candidate length should be exactly 1: the implicit background
    expect(res.candidates).toHaveLength(1)
    const implicit = res.candidates[0]
    expect(implicit.kind).toBe('official_classification')
    expect(implicit.classification.code).toBe('SR')
    expect(implicit.classification.categoryCode).toBeUndefined() // 9. Background nunca genera category
    expect(implicit.evidenceBasis).toBe('implicit_planning_background') // 13. Trazabilidad
    expect(implicit.normalizationStatus).toBe('mapped')
    expect(implicit.instrumentTraceability).toBe('verified')
    
    // 12. Conserva area/porcentaje (100%)
    expect(implicit.parcelCoverage?.parcelPercentage).toBeGreaterThan(99)

    // Should resolve to clear
    expect(res.status).toBe('clear')
    expect(result.classification?.code).toBe('SR')
  })

  it('should resolve mixed (partial SNR + partial background)', async () => {
    const adapter = new SiotugaClassificationAdapter(
      new MockFallback(),
      fixtureFetcher(feature('ames-snr', 'SNR', 'SNRSC', [
        [-8.653, 42.937],
        [-8.6515, 42.937],
        [-8.6515, 42.94],
        [-8.653, 42.94],
        [-8.653, 42.937],
      ]))
    )
    // A geometry that overlaps an SNR polygon boundary
    const location = {
      municipalityCode: '15002',
      coordinates: { lat: 42.938, lng: -8.6509 } as TerritorialCoordinates,
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [-8.653, 42.937],
              [-8.650, 42.937],
              [-8.650, 42.940],
              [-8.653, 42.940],
              [-8.653, 42.937]
            ]
          ]
        ],
        crs: 'EPSG:4326'
      } as ParcelGeometry
    }

    const result = await adapter.findApplicablePlanning(location)
    const res = result.classificationResolution!

    // Should have 2 candidates: SNR explicit, SR implicit
    expect(res.candidates).toHaveLength(2)
    const snr = res.candidates.find(c => c.classification.code === 'SNR')
    const sr = res.candidates.find(c => c.classification.code === 'SR')
    expect(snr).toBeDefined()
    expect(sr).toBeDefined()
    expect(sr?.evidenceBasis).toBe('implicit_planning_background')
    expect(snr?.evidenceBasis).toBe('parcel_geometry')

    expect(snr!.parcelCoverage!.parcelPercentage + sr!.parcelCoverage!.parcelPercentage).toBeCloseTo(100, -1)
  })

  it('should maintain current unmapped behavior for municipalities without implicit background', async () => {
    // 15058 is Oleiros, which doesn't have an implicit background configured
    const layer = getSiotugaClassificationLayer('15058')
    expect(layer?.implicitBackgroundClassification).toBeUndefined()

    const adapter = new SiotugaClassificationAdapter(
      new MockFallback(),
      fixtureFetcher(feature('oleiros-partial', 'SU', 'SUC', [
        [-8.318, 43.332],
        [-8.3175, 43.332],
        [-8.3175, 43.333],
        [-8.318, 43.333],
        [-8.318, 43.332],
      ]))
    )
    const location = {
      municipalityCode: '15058',
      coordinates: { lat: 43.332, lng: -8.318 } as TerritorialCoordinates,
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [-8.318, 43.332],
              [-8.317, 43.332],
              [-8.317, 43.333],
              [-8.318, 43.333],
              [-8.318, 43.332]
            ]
          ]
        ],
        crs: 'EPSG:4326'
      } as ParcelGeometry
    }

    const result = await adapter.findApplicablePlanning(location)
    const res = result.classificationResolution!

    // If it falls outside polygons and has no background, it produces NO candidates
    // (if completely outside) or some candidates + derived_unmapped_complement.
    // In this case, we just expect the partial_parcel_coverage discrepancy to be present
    expect(res.status).toBe('review_required')
  })

  it('should pass regression for Sada (15075)', async () => {
    const adapter = new SiotugaClassificationAdapter(
      new MockFallback(),
      fixtureFetcher(feature('sada-snrc', 'SNR', 'SNRC', [
        [-8.2977, 43.37859],
        [-8.29759, 43.37859],
        [-8.29759, 43.37869],
        [-8.2977, 43.37869],
        [-8.2977, 43.37859],
      ]))
    )
    const location = {
      municipalityCode: '15075',
      coordinates: { lat: 43.3786, lng: -8.2976 } as TerritorialCoordinates,
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [-8.2977, 43.37859],
              [-8.29759, 43.37859],
              [-8.29759, 43.37869],
              [-8.2977, 43.37869],
              [-8.2977, 43.37859],
            ]
          ]
        ],
        crs: 'EPSG:4326'
      } as ParcelGeometry
    }
    const result = await adapter.findApplicablePlanning(location)
    const res = result.classificationResolution!
    expect(res.candidates.length).toBeGreaterThan(0)
    expect(res.candidates.every(c => c.kind === 'official_classification' && c.evidenceBasis === 'parcel_geometry')).toBe(true)
  })
})
