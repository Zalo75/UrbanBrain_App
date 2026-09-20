import { describe, expect, it } from 'vitest'

import type { PlanningApplicability } from '@/domain/territorial-resolver/types'
import { resolveParcelLocation } from '@/application/territorial-resolver/resolveParcelLocation'
import { MultiSourceClassificationResolver } from '@/application/territorial-resolver/multiSourceClassificationResolver'
import { SiotugaClassificationSourceAdapter } from './SiotugaClassificationAdapter'

const planning: PlanningApplicability = {
  status: 'determined',
  instrument: 'Normas subsidiarias',
  approvalDate: '1996-06-27T00:00:00.000Z',
  applicableInstruments: [{
    id: '22284', name: 'Normas subsidiarias', kind: 'general', status: 'current',
    approvalDate: '1996-06-27',
    sourceUrl: 'https://siotuga.xunta.gal/siotuga/inventario.php?inv=1&idconcello=15024',
  }],
  evidence: [], warnings: [],
}

const geometry = {
  type: 'MultiPolygon' as const,
  coordinates: [[[[-8.1, 43.2], [-8.099, 43.2], [-8.099, 43.201], [-8.1, 43.2]]]],
  crs: 'EPSG:4326' as const,
}

function feature() {
  return '<gml:featureMember><ms:classification gml:id="cerceda.1"><ms:geom><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>43.2 -8.1 43.2 -8.099 43.201 -8.099 43.2 -8.1</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></ms:geom><ms:cla_homo>SU</ms:cla_homo><ms:cat_homo>SUC</ms:cat_homo><ms:denom>Centro</ms:denom></ms:classification></gml:featureMember>'
}

describe('SIOTUGA dynamic classification discovery', () => {
  it('discovers Cerceda resources and queries the discovered classification layer', async () => {
    const calls: string[] = []
    const fetcher = async (input: string | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('REQUEST=GetCapabilities') && url.includes('SERVICE=WFS')) {
        return new Response('<WFS_Capabilities><Name>_15024_NNSSPP_199606_AD_3CLAS_22284</Name></WFS_Capabilities>')
      }
      if (url.includes('REQUEST=GetCapabilities') && url.includes('SERVICE=WMS')) {
        return new Response('<WMS_Capabilities><Name>_15024_NNSSPP_199606_AD_PORD_02CL_22284</Name></WMS_Capabilities>')
      }
      return new Response(`<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs" xmlns:gml="http://www.opengis.net/gml" xmlns:ms="http://mapserver.gis.umn.edu/mapserver">${feature()}</wfs:FeatureCollection>`)
    }

    const result = await new SiotugaClassificationSourceAdapter(fetcher, 1_000).findClassifications(
      planning,
      { municipalityCode: '15024', geometry }
    )

    expect(result.candidates[0]?.classification).toMatchObject({ code: 'SU', categoryCode: 'SUC' })
    expect(result.resources).toMatchObject({
      classificationLayer: '_15024_NNSSPP_199606_AD_3CLAS_22284',
      detailedPlanningLayer: '_15024_NNSSPP_199606_AD_PORD_02CL_22284',
    })
    expect(calls.some((url) => url.includes('REQUEST=GetFeature') && url.includes('3CLAS_22284'))).toBe(true)
  })

  it('keeps the discovered resources through the territorial resolver for Cerceda', async () => {
    const fetcher = async (input: string | URL) => {
      const url = String(input)
      if (url.includes('REQUEST=GetCapabilities') && url.includes('SERVICE=WFS')) {
        return new Response('<WFS_Capabilities><Name>_15024_NNSSPP_199606_AD_3CLAS_22284</Name></WFS_Capabilities>')
      }
      if (url.includes('REQUEST=GetCapabilities') && url.includes('SERVICE=WMS')) {
        return new Response('<WMS_Capabilities><Name>_15024_NNSSPP_199606_AD_PORD_02CL_22284</Name></WMS_Capabilities>')
      }
      return new Response(`<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs" xmlns:gml="http://www.opengis.net/gml" xmlns:ms="http://mapserver.gis.umn.edu/mapserver">${feature()}</wfs:FeatureCollection>`)
    }
    const planningPort = { findApplicablePlanning: async () => planning }
    const territorialPlanning = new MultiSourceClassificationResolver(planningPort, [{
      id: 'SIOTUGA WFS',
      source: 'siotuga',
      adapter: new SiotugaClassificationSourceAdapter(fetcher, 1_000),
      requiredForAutomaticDecision: true,
    }])
    const result = await resolveParcelLocation(
      { cadastralReference: '15024A013000010000AA' },
      {
        catastro: {
          resolveReference: async () => ({
            cadastralReference: '15024A01300001',
            municipality: 'Cerceda',
            municipalityCode: '15024',
            coordinates: { lat: 43.2, lng: -8.1 },
            geometry,
            evidence: [{ source: 'catastro', sourceUrl: 'https://catastro.test', retrievedAt: '2026-08-19T00:00:00.000Z', method: 'fixture' }],
          }),
          resolveCoordinates: async () => null,
        },
        geocoder: { geocode: async () => [], reverse: async () => null },
        planning: territorialPlanning,
        affects: { findAffects: async () => ({ analysisGeometry: 'parcel', detected: [], canRuleOutUndetectedAffects: true, warnings: [] }) },
        now: () => new Date('2026-08-19T00:00:00.000Z'),
      }
    )

    expect(result.municipalityCode).toBe('15024')
    expect(result.planning.resources).toMatchObject({
      classificationLayer: '_15024_NNSSPP_199606_AD_3CLAS_22284',
      detailedPlanningLayer: '_15024_NNSSPP_199606_AD_PORD_02CL_22284',
    })
  })
})
