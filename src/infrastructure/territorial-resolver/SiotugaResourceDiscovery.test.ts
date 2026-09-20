import { describe, expect, it } from 'vitest'

import type { PlanningApplicability } from '@/domain/territorial-resolver/types'
import {
  buildSiotugaResourceCatalog,
  discoverSiotugaResources,
  extractSiotugaLayerNames,
} from './SiotugaResourceDiscovery'

const planning: PlanningApplicability = {
  status: 'determined',
  instrument: 'Normas subsidiarias',
  approvalDate: '1996-06-27T00:00:00.000Z',
  applicableInstruments: [{
    id: '22284',
    name: 'Normas subsidiarias',
    kind: 'general',
    status: 'current',
    approvalDate: '1996-06-27',
    sourceUrl: 'https://siotuga.xunta.gal/siotuga/inventario.php?inv=1&idconcello=15024',
  }],
  evidence: [],
  warnings: [],
}

describe('SIOTUGA resource discovery', () => {
  it('extracts only layers belonging to the requested municipality', () => {
    expect(extractSiotugaLayerNames(
      '<Capabilities><Name>_15024_NNSSPP_199606_AD_3CLAS_22284</Name><Name>_15031_PXOU_198707_AD_3CLAS_22310</Name></Capabilities>',
      '15024'
    )).toEqual(['_15024_NNSSPP_199606_AD_3CLAS_22284'])
  })

  it('derives classification and detailed planning from the current instrument id', () => {
    const result = buildSiotugaResourceCatalog('15024', planning, [
      '_15024_NNSSPP_199606_AD_3CLAS_22284',
      '_15024_NNSSPP_199606_AD_1DEL_22284',
    ], [
      '_15024_NNSSPP_199606_AD_PORD_02CL_22284',
      '_15024_NNSSPP_199606_AD_PORD_02CL_TILEINDEX_22284',
    ])
    expect(result).toMatchObject({
      classificationLayer: '_15024_NNSSPP_199606_AD_3CLAS_22284',
      detailedPlanningLayer: '_15024_NNSSPP_199606_AD_PORD_02CL_22284',
      planningTileIndex: '_15024_NNSSPP_199606_AD_PORD_02CL_TILEINDEX_22284',
      boundaryLayer: '_15024_NNSSPP_199606_AD_1DEL_22284',
    })
  })

  it('discovers resources before querying an unregistered municipality', async () => {
    const fetcher = async (input: string | URL) => {
      const url = String(input)
      if (url.includes('SERVICE=WFS')) {
        return new Response('<WFS_Capabilities><Name>_15024_NNSSPP_199606_AD_3CLAS_22284</Name></WFS_Capabilities>')
      }
      return new Response('<WMS_Capabilities><Name>_15024_NNSSPP_199606_AD_PORD_02CL_22284</Name></WMS_Capabilities>')
    }
    const result = await discoverSiotugaResources('15024', planning, fetcher, 1_000)
    expect(result.catalog).toMatchObject({
      classificationLayer: '_15024_NNSSPP_199606_AD_3CLAS_22284',
      detailedPlanningLayer: '_15024_NNSSPP_199606_AD_PORD_02CL_22284',
    })
  })
})
