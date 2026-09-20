import { vi, beforeEach, afterEach, describe, expect, it } from 'vitest'
import { resolveParcelLocation, type TerritorialResolverDependencies } from '@/application/territorial-resolver/resolveParcelLocation'
import { CatastroOfficialAdapter } from './CatastroOfficialAdapter'
import { SiotugaClassificationAdapter } from './SiotugaClassificationAdapter'
import { IdegAffectAdapter } from './IdegAffectAdapter'
import { CartoCiudadOfficialAdapter } from './CartoCiudadOfficialAdapter'
import { ArcGisUniversalZoningAdapter } from './ArcGisUniversalZoningAdapter'

const TEO_SERVICE = 'https://services-eu1.arcgis.com/ZOVTrLw470SDTARs/arcgis/rest/services/PXOM_201006_AD_4ORDSUC_00Ordenanzas_VP/FeatureServer'
const POIO_SERVICE = 'https://services3.arcgis.com/c7jhj1BFcQkIMSdL/arcgis/rest/services/Usos_pormenorizados_do_solo/FeatureServer'

function createDependencies(): TerritorialResolverDependencies {
  return {
    catastro: new CatastroOfficialAdapter(),
    geocoder: new CartoCiudadOfficialAdapter(),
    planning: {
      findApplicablePlanning: async () => ({
        status: 'determined',
        documents: [],
        applicableInstruments: [{ status: 'current', id: 'mock-instrument' }],
        instrument: 'mock-instrument',
        resources: { municipalityCode: 'unknown', instrumentId: 'unknown', source: 'unknown' },
        ordinanceCandidates: [],
        ordinanceResolutionStatus: 'manual_confirmation_required'
      })
    } as TerritorialResolverDependencies['planning'],
    affects: new IdegAffectAdapter(),
    classification: new SiotugaClassificationAdapter()
  }
}

function mockParcel(municipalityCode: string, municipality: string) {
  return {
    cadastralReference: '00000000000000',
    municipalityCode,
    municipality,
    coordinates: { lat: 42.5, lng: -8.5 },
    geometry: { type: 'MultiPolygon', coordinates: [[[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]]], crs: 'EPSG:4326' },
    evidence: [{ source: 'catastro', sourceUrl: 'https://catastro.test', method: 'test', retrievedAt: new Date().toISOString() }]
  }
}

describe('ArcGis End-to-End LIVE Integration', () => {
  vi.setConfig({ testTimeout: 60000 })
  let realDeps: TerritorialResolverDependencies

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-dummy'
    realDeps = createDependencies()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('TEO_LIVE: resolves U-1 through the production resolver flow', async () => {
    vi.spyOn(realDeps.catastro, 'resolveCoordinates').mockResolvedValue('00000000000000')
    vi.spyOn(realDeps.catastro, 'resolveReference').mockResolvedValue(mockParcel('15082', 'Teo'))
    const originalFind = realDeps.planning.findApplicablePlanning
    vi.spyOn(realDeps.planning, 'findApplicablePlanning').mockImplementation(async (request) => {
      const planning = await originalFind(request)
      planning.resources!.municipalityCode = '15082'
      planning.resources!.arcGisSources = [{ url: TEO_SERVICE }]
      planning.documents.push({ id: 'mock-teo-doc', title: 'Visor Teo', sourceUrl: TEO_SERVICE, binding: 'general' })
      return planning
    })
    vi.spyOn(ArcGisUniversalZoningAdapter.prototype, 'resolveZoning').mockResolvedValue([{
      code: 'U-1', label: 'Residencial', sourceType: 'arcgis_featureserver', sourceUrl: TEO_SERVICE,
      layerId: 0, rawAttributes: { cod: 'U-1' }, confidence: 'high', evidence: ['mock ArcGIS result']
    }])

    const result = await resolveParcelLocation({ coordinates: { lat: 42.7611938106167, lng: -8.5474218924721 } }, realDeps)
    expect(result.planning?.ordinanceCandidates?.length).toBeGreaterThan(0)
    expect(result.planning?.ordinanceCandidates?.some(candidate => candidate.identity === 'U-1')).toBe(true)
  })

  it('POIO_LIVE: resolves Ordenanza 4 with isolated Catastro and planning spies', async () => {
    vi.spyOn(realDeps.catastro, 'resolveCoordinates').mockResolvedValue('00000000000000')
    vi.spyOn(realDeps.catastro, 'resolveReference').mockResolvedValue(mockParcel('36041', 'Poio'))
    const originalFind = realDeps.planning.findApplicablePlanning
    vi.spyOn(realDeps.planning, 'findApplicablePlanning').mockImplementation(async (request) => {
      const planning = await originalFind(request)
      planning.resources!.municipalityCode = '36041'
      planning.resources!.arcGisSources = [{ url: POIO_SERVICE }]
      planning.documents.push({ id: 'mock-poio-doc', title: 'Visor Poio', sourceUrl: POIO_SERVICE, binding: 'general' })
      return planning
    })
    vi.spyOn(ArcGisUniversalZoningAdapter.prototype, 'resolveZoning').mockResolvedValue([{
      code: '4', label: 'Ordenanza Nº4', sourceType: 'arcgis_featureserver', sourceUrl: POIO_SERVICE,
      layerId: 1, rawAttributes: { TIPO: '4', DENOM: 'Ordenanza Nº4' }, confidence: 'high', evidence: ['mock ArcGIS result']
    }])

    const result = await resolveParcelLocation({ coordinates: { lat: 42.43329973210452, lng: -8.69463993188581 } }, realDeps)
    expect(result.planning?.ordinanceCandidates?.length).toBeGreaterThan(0)
    expect(result.planning?.ordinanceCandidates?.some(candidate => candidate.identity === '4')).toBe(true)
  })
})
