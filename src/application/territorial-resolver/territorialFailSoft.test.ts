import { describe, expect, it } from 'vitest'
import { resolveParcelLocation } from './resolveParcelLocation'
import { OfficialServiceError } from '@/infrastructure/territorial-resolver/officialHttp'
import type {
  AffectPort,
  CatastroPort,
  GeocoderPort,
  PlanningPort,
} from '@/domain/territorial-resolver/types'
import type { DetailedZoningStrategy } from './ordinanceCandidateResolver'
import { resolveOrdinanceCandidatesDetailed } from './ordinanceCandidateResolver'

const mockCatastro: CatastroPort = {
  resolveReference: async (ref) => ({
    cadastralReference: ref,
    normalizedAddress: 'AVENIDA PRINCIPAL 1, BETANZOS',
    municipality: 'Betanzos',
    municipalityCode: '15009',
    province: 'A Coruña',
    provinceCode: '15',
    coordinates: { lat: 43.28, lng: -8.21 },
    geometry: {
      type: 'MultiPolygon',
      coordinates: [[[[ -8.21, 43.28 ], [ -8.211, 43.28 ], [ -8.211, 43.281 ], [ -8.21, 43.281 ], [ -8.21, 43.28 ]]]],
      crs: 'EPSG:4326',
    },
    evidence: [
      {
        source: 'catastro',
        sourceUrl: 'https://catastro.test',
        retrievedAt: '2026-08-25T00:00:00.000Z',
        method: 'mock',
      },
    ],
  }),
  resolveCoordinates: async () => null,
  resolveAddress: async () => null,
}

const mockGeocoder: GeocoderPort = {
  geocode: async () => [],
  reverseGeocode: async () => undefined,
}

const mockPlanning: PlanningPort = {
  findApplicablePlanning: async () => ({
    status: 'determined',
    instrument: 'PXOM Betanzos',
    applicableInstruments: [
      {
        id: '28007',
        name: 'PXOM Betanzos',
        kind: 'general',
        status: 'current',
        approvalDate: '2014-01-01',
        sourceUrl: 'https://siotuga.xunta.gal/test',
      },
    ],
  }),
}

const mockAffects: AffectPort = {
  findAffects: async () => ({
    analysisGeometry: 'point',
    detected: [],
    canRuleOutUndetectedAffects: false,
    warnings: [],
  }),
}

describe('Territorial Resolver Fail-Soft Architecture', () => {
  it('CASO A — Proveedor auxiliar caído degrada ordenanzas pero PRESERVA el contexto territorial básico', async () => {
    const failingStrategy: DetailedZoningStrategy = {
      id: 'failing-wms-strategy',
      resolve: async () => {
        throw new OfficialServiceError(
          'SIOTUGA WMS',
          'unavailable',
          'SIOTUGA WMS no está disponible temporalmente.'
        )
      },
    }

    const planning = await mockPlanning.findApplicablePlanning({})
    const detailed = await resolveOrdinanceCandidatesDetailed(planning, {
      municipalityCode: '15009',
      strategies: [failingStrategy],
    })

    expect(detailed.status).toBe('manual_confirmation_required')
    expect(detailed.candidates).toHaveLength(0)

    // Now test end-to-end via resolveParcelLocation
    const result = await resolveParcelLocation(
      { cadastralReference: '15009A01300255' },
      {
        catastro: mockCatastro,
        geocoder: mockGeocoder,
        planning: {
          findApplicablePlanning: async () => ({
            ...planning,
            classificationResolution: {
              status: 'review_required',
              candidates: [],
            },
          }),
        },
        affects: mockAffects,
      }
    )

    // Basic territorial context is fully preserved
    expect(result.status).toBe('confirmed')
    expect(result.municipality).toBe('Betanzos')
    expect(result.municipalityCode).toBe('15009')
    expect(result.coordinates).toEqual({ lat: 43.28, lng: -8.21 })
    expect(result.parcelGeometry).toBeDefined()
    expect(result.planning.instrument).toBe('PXOM Betanzos')
    // Zoning is safely empty / manual confirmation
    expect(result.planning.ordinanceCandidates ?? []).toHaveLength(0)
  })

  it('CASO B — Proveedor funcionando propaga candidatos acreditados normalmente', async () => {
    const workingStrategy: DetailedZoningStrategy = {
      id: 'working-prepared-strategy',
      resolve: async () => [
        {
          identity: 'ORD-1',
          instrumentId: '28007',
          sourceRef: 'https://test',
          spatialEvidence: 'Spatial match on layer',
          graphicEvidence: 'Graphic label ORD-1',
          legendEvidence: 'Legend match',
          documentaryEvidence: 'Ficha 1',
          instrumentMembership: true,
          provenance: ['prepared_layer'],
          confidence: 'high',
          coverage: { percentage: 100, areaSquareMetres: 500 },
        },
      ],
    }

    const planning = await mockPlanning.findApplicablePlanning({})
    const detailed = await resolveOrdinanceCandidatesDetailed(planning, {
      municipalityCode: '15009',
      strategies: [workingStrategy],
    })

    expect(detailed.status).toBe('automatically_determined')
    expect(detailed.candidates).toHaveLength(1)
    expect(detailed.candidates[0].identity).toBe('ORD-1')
  })

  it('CASO C — Error interno de programación NO se traga silenciosamente', async () => {
    const buggyStrategy: DetailedZoningStrategy = {
      id: 'buggy-code-strategy',
      resolve: async () => {
        // Simulates an internal coding bug (e.g. accessing undefined property on a null object)
        const nullObj: Record<string, unknown> | null = null
        return (nullObj as unknown as { someProperty: { thatDoesNotExist: unknown } }).someProperty.thatDoesNotExist as never
      },
    }

    const planning = await mockPlanning.findApplicablePlanning({})
    await expect(
      resolveOrdinanceCandidatesDetailed(planning, {
        municipalityCode: '15009',
        strategies: [buggyStrategy],
      })
    ).rejects.toThrow(TypeError)
  })

  it('CASO D — Regresión del alta: la detección territorial básica produce un payload consumible por el formulario tras fallo auxiliar', async () => {
    const { summarizeSmartCaseDetection } = await import('@/app/(dashboard)/expedientes/new/smartCaseDetection')

    const planning = await mockPlanning.findApplicablePlanning({})
    const resolution = await resolveParcelLocation(
      { cadastralReference: '15009A01300255' },
      {
        catastro: mockCatastro,
        geocoder: mockGeocoder,
        planning: {
          findApplicablePlanning: async () => ({
            ...planning,
            classificationResolution: {
              status: 'review_required',
              candidates: [],
            },
          }),
        },
        affects: mockAffects,
      }
    )

    const summarized = summarizeSmartCaseDetection(resolution)
    expect(summarized.detected.cadastralReference).toBe('15009A01300255')
    expect(summarized.detected.municipalityName).toBe('Betanzos')
    expect(summarized.detected.municipalityCode).toBe('15009')
    expect(summarized.detected.provinceId).toBe('a_coruna')
    expect(summarized.detected.planeamiento).toBe('PXOM Betanzos')
    expect(summarized.detected.lat).toBe(43.28)
    expect(summarized.detected.lng).toBe(-8.21)
    expect(summarized.detected.parcelGeometry).toBeDefined()
    expect(summarized.progress.length).toBeGreaterThan(0)
  })
})
