import { describe, expect, it, vi } from 'vitest'
import { SiotugaDetailedZoningEvidenceProvider } from './SiotugaDetailedZoningEvidenceProvider'

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64'))

function planning() {
  return {
    status: 'determined' as const,
    instrument: 'official',
    applicableInstruments: [{
      id: '99999', name: 'official', kind: 'PXOM', status: 'current' as const, sourceUrl: 'https://official.invalid/99999',
    }],
    evidence: [], warnings: [],
  }
}

describe('SiotugaDetailedZoningEvidenceProvider', () => {
  it('fails closed without a visual/document interpreter', async () => {
    const fetcher = vi.fn()
    const result = await new SiotugaDetailedZoningEvidenceProvider({ fetcher: fetcher as typeof fetch }).resolve({
      planning: planning(), municipalityCode: '15000', coordinates: { lat: 43, lng: -8 },
    })
    expect(result).toEqual([])
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('discovers the PORD resource, obtains official inventory and emits only validated observations', async () => {
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.includes('REQUEST=GetCapabilities') && url.includes('SERVICE=WFS')) {
        return new Response('<WFS_Capabilities><FeatureType><Name>_15000_PXOM_200204_AD_3CLAS_99999</Name></FeatureType></WFS_Capabilities>')
      }
      if (url.includes('REQUEST=GetCapabilities') && url.includes('SERVICE=WMS')) {
        return new Response('<WMS_Capabilities><Layer><Name>_15000_PXOM_200204_AD_PORD_02CL_99999</Name></Layer><Layer><Name>_15000_PXOM_200204_AD_PORD_02CL_TILEINDEX_99999</Name></Layer></WMS_Capabilities>')
      }
      if (url.includes('inventario.php')) return new Response('<input id="token" value="token">', { headers: { 'set-cookie': 'PHPSESSID=test-session; Path=/' } })
      if (url.includes('getIOTPU.php')) {
        return new Response(JSON.stringify({ datos_xerais: { id: '99999', filesroot: 'root', folder: 'TEST' }, elementos: [{ description: 'NORMATIVA', componentes: [{ id: 'doc-1', pathesperado: 'normativa.pdf', descripcion: 'normativa' }] }] }))
      }
      if (url.includes('GetMap')) return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } })
      if (url.includes('GetLegendGraphic')) return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } })
      if (url.includes('GetFeatureInfo')) return new Response('<gml:coordinates>-8.1,43.1 -8.0,43.1 -8.0,43.0 -8.1,43.0 -8.1,43.1</gml:coordinates><filename>sheet.tif</filename><gid>1</gid>')
      throw new Error(`unexpected URL ${url}`)
    }) as unknown as typeof fetch
    const result = await new SiotugaDetailedZoningEvidenceProvider({
      fetcher,
      interpreter: { inspect: async () => [{ observedLabel: 'Z-4', parcelRelation: 'contains' as const, confidence: 'high' as const }] },
      documentValidator: {
        validate: async ({ observedLabel, instrumentId, documents }) => ({
          identity: `Ordenanza ${observedLabel}`,
          sourceDocument: documents[0]?.sourceUrl,
          documentaryEvidence: `documento ${instrumentId} valida ${observedLabel}`,
        }),
      },
    }).resolve({
      planning: planning(), municipalityCode: '15000', coordinates: { lat: 43, lng: -8 },
      geometry: { type: 'MultiPolygon', coordinates: [[[[ -8.00001, 43.00001 ], [ -7.99999, 43.00001 ], [ -7.99999, 42.99999 ], [ -8.00001, 42.99999 ], [ -8.00001, 43.00001 ]]]], crs: 'EPSG:4326' },
    })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ identity: 'Ordenanza Z-4', instrumentId: '99999', instrumentMembership: true })
    expect(result[0]?.spatialEvidence).toContain('PORD_02CL')
  })

  it('tries at most two marked passes and fails closed when only the legend is readable', async () => {
    let maps = 0
    const fetcher = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.includes('GetCapabilities')) return new Response('<WMS_Capabilities><Layer><Name>_15000_PXOM_200204_AD_PORD_02CL_99999</Name></Layer></WMS_Capabilities>')
      if (url.includes('GetMap')) { maps += 1; return new Response(PNG, { status: 200 }) }
      if (url.includes('GetLegendGraphic')) return new Response(PNG, { status: 200 })
      if (url.includes('GetFeatureInfo')) return new Response('')
      throw new Error(`unexpected URL ${url}`)
    }) as unknown as typeof fetch
    const provider = new SiotugaDetailedZoningEvidenceProvider({
      fetcher,
      interpreter: { inspect: async () => [{ observedLabel: null, parcelRelation: 'unknown' as const, competingLabels: ['A', 'B'] }] },
      documentValidator: { validate: async () => null },
    })
    const result = await provider.resolve({
      planning: planning(), municipalityCode: '15000', coordinates: { lat: 43, lng: -8 },
      geometry: { type: 'MultiPolygon', coordinates: [[[[ -8.00001, 43.00001 ], [ -7.99999, 43.00001 ], [ -7.99999, 42.99999 ], [ -8.00001, 42.99999 ], [ -8.00001, 43.00001 ]]]], crs: 'EPSG:4326' },
    })
    expect(maps).toBe(2)
    expect(result).toEqual([])
    expect(provider.getVisualResult()).toMatchObject({
      resolutionState: 'resolved',
      observations: [{ observedLabel: null, competingLabels: ['A', 'B'], provenance: expect.any(Array) }],
    })
  })
})
