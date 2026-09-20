import { describe, expect, it } from 'vitest'
import { createSiotugaRasterZoningPortFactory } from './siotugaRasterZoningPorts'
import { matchSheetToOfficialControls, selectUniqueSpatialMatch } from './contentDrivenSheetMatcher'

const planning = {
  status: 'determined' as const,
  applicableInstruments: [{ id: '23045', name: 'plan', status: 'current' as const }],
  documents: [{ id: 'doc', instrumentId: '23045', title: 'normativa', sourceUrl: 'https://example.invalid/doc.pdf', binding: 'general' as const }],
  evidence: [],
  warnings: [],
}

describe('SIOTUGA raster production ports', () => {
  it('exposes all six ports and accepts only the official WMS BBOX transform', async () => {
    const calls: string[] = []
    const fetcher = async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('GetFeatureInfo')) {
        return new Response('<gml:coordinates>-8,42 -8,42.001 -7.999,42.001</gml:coordinates><filename>sheet.jpg</filename><location>/maps/sheet.jpg</location>', { status: 200 })
      }
      if (url.includes('GetMap') || url.includes('GetLegendGraphic')) return new Response(Buffer.from('not-an-image'), { status: 200 })
      if (url.includes('GetCapabilities')) return new Response('<Name>_36059_NNSSPP_199302_AD_PORD_02CL_TILEINDEX_23045</Name>', { status: 200 })
      return new Response('', { status: 404 })
    }
    const factory = createSiotugaRasterZoningPortFactory(fetcher)
    const input = { municipalityCode: '36059', instrumentId: '23045', parcelGeometry: { type: 'Polygon', coordinates: [] } as never }
    const ports = factory.create({ strategyContext: { planning, municipalityCode: '36059', coordinates: { lat: 42, lng: -8 }, geometry: input.parcelGeometry }, input })
    expect(ports).not.toBeNull()
    expect(Object.keys(ports ?? {}).sort()).toEqual(['detectSymbols', 'discoverSheets', 'extractBoundaries', 'georeference', 'intersectParcel', 'respectsSuperiorVector', 'validateNormative'].sort())
    const sheets = await ports!.discoverSheets(input)
    expect(sheets).toHaveLength(1)
    const georef = await ports!.georeference(input, sheets[0]!)
    expect(georef.accepted).toBe(true)
    expect(georef.method).toBe('official-wms-bbox-pixel-affine')
    expect(calls.some((url) => url.includes('GetMap'))).toBe(true)
    expect(calls.some((url) => url.includes('GetLegendGraphic'))).toBe(true)
  })

  it('does not select an inventory sheet without official spatial extent', async () => {
    const fetcher = async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('inventario.php')) {
        return new Response('<input type="hidden" name="token" value="test-token" />', {
          status: 200,
          headers: { 'set-cookie': 'session=123' },
        })
      }
      if (url.includes('getIOTPU.php')) {
        return new Response(JSON.stringify({
          datos_xerais: { filesroot: 'https://siotuga.xunta.gal/siotuga/documentos/urbanismo/', folder: 'VILADECRUCES' },
          elementos: [
            {
              id: '730',
              description: 'P. ORD: ORDENACION TERMO MUNICIPAL',
              componentes: [
                { pathesperado: '1002pb006.jpg', id: '2539', descripcion: 'O-4-6. SUELO NO URBANIZABLE DE CARACTER NORMAL Y PROTEGIDO. 1/10000' }
              ]
            },
            {
              id: '733',
              description: 'P. ORD: ORDENACION SOLO URBANO: VILA DE CRUCES',
              componentes: [
                { pathesperado: '1002su001.jpg', id: '6687', descripcion: 'O-1. CLASIFICACION DEL SUELO, CALIFICACION DEL SUELO. 1/2000' },
                { pathesperado: '1002su002.jpg', id: '4867', descripcion: 'O-2. TRAZADO Y CARACTERISTICAS DE LA RED VIARIA EN SUELO URBANO. 1/2000' }
              ]
            }
          ]
        }), { status: 200 })
      }
      if (url.includes('1002su001.jpg')) {
        return new Response(Buffer.from('fake-image-bytes'), { status: 200 })
      }
      return new Response('', { status: 404 })
    }

    const factory = createSiotugaRasterZoningPortFactory(fetcher)
    const input = { municipalityCode: '36059', instrumentId: '23045', parcelGeometry: { type: 'Polygon', coordinates: [] } as never }
    const ports = factory.create({ strategyContext: { planning, municipalityCode: '36059', coordinates: { lat: 42, lng: -8 }, geometry: input.parcelGeometry }, input })
    const sheets = await ports!.discoverSheets(input)
    expect(sheets).toEqual([])
  })

  it('accepts only a sheet with an official extent and official controls', () => {
    const result = matchSheetToOfficialControls({
      id: '23045:1002su001.jpg',
      sourceUrl: 'https://example.invalid/1002su001.jpg',
      format: 'jpg',
      scaleDenominator: 2000,
      bbox: { minLat: 42, minLng: -8, maxLat: 42.01, maxLng: -7.99 },
      provenance: ['siotuga:inventory:6687', 'role:zoning'],
    }, [{ id: 'f1', geometry: {}, source: '3CLAS' }], {
      tiePoints: [
        { pixel: [0, 0], coordinate: [-8, 42] },
        { pixel: [100, 0], coordinate: [-7.99, 42] },
        { pixel: [0, 100], coordinate: [-8, 42.01] },
      ],
      topologyScore: 0.98,
    })
    expect(result.accepted).toBe(true)
    expect(result.transform).toBe('affine-least-squares')
  })

  it('does not select a nominal winner when spatial scores are materially tied', () => {
    expect(selectUniqueSpatialMatch([
      { sheetId: 'a', accepted: true, topologyScore: 0.18, reason: 'x', provenance: [] },
      { sheetId: 'b', accepted: true, topologyScore: 0.16, reason: 'x', provenance: [] },
    ])).toBeUndefined()
  })

  it('does not assign a WMS activeMapBbox as a valid georeference for an original inventory sheet (HAS Paso 2 Test E)', async () => {
    const factory = createSiotugaRasterZoningPortFactory()
    const input = { municipalityCode: '36059', instrumentId: '23045', parcelGeometry: { type: 'Polygon', coordinates: [] } as never }
    const ports = factory.create({ strategyContext: { planning, municipalityCode: '36059', coordinates: { lat: 42, lng: -8 }, geometry: input.parcelGeometry }, input })
    
    // Create a mock sheet that represents an original downloaded inventory sheet
    const inventorySheet = {
      id: '123',
      sourceUrl: 'https://test/1002su001.jpg',
      format: 'jpg' as const,
      provenance: ['siotuga:inventory:123'],
      bbox: { minLat: 42, minLng: -8, maxLat: 42.01, maxLng: -7.99 }
    }

    const georef = await ports!.georeference(input, inventorySheet)
    
    // Assert conditions for Test E
    expect(georef.accepted).toBe(false)
    expect(georef.method).not.toBe('official-wms-bbox-pixel-affine')
    expect(georef).not.toHaveProperty('pixelBbox')
    expect(georef.provenance).toContain('georeference:missing-official-extent-for-original-raster')
  })
})
