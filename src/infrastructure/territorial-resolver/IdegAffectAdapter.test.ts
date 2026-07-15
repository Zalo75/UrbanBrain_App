import { describe, expect, it, vi } from 'vitest'

import { IdegAffectAdapter, VERIFIED_AFFECT_LAYERS } from './IdegAffectAdapter'

const layer = {
  id: 'test-layer',
  category: 'patrimonio_cultural',
  name: 'Contorno de protección',
  url: 'https://ideg.xunta.gal/servizos/rest/services/test/MapServer/1/query',
}

describe('IdegAffectAdapter', () => {
  it('incluye las coberturas oficiales verificadas para el piloto de Betanzos', () => {
    expect(VERIFIED_AFFECT_LAYERS.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'bic_integral_area',
        'natura_2000_zec',
        'water_channel_police',
        'water_preferential_flow',
        'water_public_domain',
        'road_autonomic_domain_cc',
        'road_autonomic_domain_vac',
        'road_autonomic_affect_cc',
        'road_autonomic_affect_vac',
        'road_state_provincial_area',
        'approved_road_project',
      ])
    )
  })

  it('conserva una intersección positiva con evidencia oficial', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ features: [{ attributes: { OBJECTID: 7, NOMBRE: 'BIC' } }] }),
          {
            status: 200,
          }
        )
    )
    const result = await new IdegAffectAdapter(fetcher, 1000, () => new Date('2026-07-13'), [
      layer,
    ]).findAffects({ coordinates: { lat: 43.37, lng: -8.4 } })

    expect(result.detected[0]).toMatchObject({
      category: 'patrimonio_cultural',
      name: 'Contorno de protección',
      attributes: { OBJECTID: 7, NOMBRE: 'BIC' },
    })
    expect(result.detected[0].evidence.source).toBe('ideg')
    expect(result.canRuleOutUndetectedAffects).toBe(false)
    const [requestedUrl, request] = fetcher.mock.calls[0]
    expect(String(requestedUrl)).toBe(layer.url)
    expect(request).toMatchObject({ method: 'POST' })
    const body = new URLSearchParams(String(request?.body))
    expect(body.get('geometryType')).toBe('esriGeometryPoint')
    expect(body.get('geometry')).toBe('-8.4,43.37')
  })

  it('no interpreta cero resultados como ausencia de afecciones', async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ features: [] }), { status: 200 })
    )
    const result = await new IdegAffectAdapter(fetcher, 1000, () => new Date(), [
      layer,
    ]).findAffects({
      coordinates: { lat: 43.37, lng: -8.4 },
    })
    expect(result.detected).toEqual([])
    expect(result.canRuleOutUndetectedAffects).toBe(false)
    expect(result.warnings.map((warning) => warning.code)).toContain('partial_affect_coverage')
    expect(result.warnings.map((warning) => warning.code)).toContain('point_only_affect_analysis')
  })

  it('envía una geometría parcelaria en el cuerpo POST y no en la URL', async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ features: [] }), { status: 200 })
    )
    await new IdegAffectAdapter(fetcher, 1000, () => new Date(), [layer]).findAffects({
      geometry: {
        type: 'MultiPolygon',
        crs: 'EPSG:4326',
        coordinates: [
          [
            [
              [-8.4, 43.37],
              [-8.39, 43.37],
              [-8.39, 43.38],
              [-8.4, 43.37],
            ],
          ],
        ],
      },
    })

    const [requestedUrl, request] = fetcher.mock.calls[0]
    expect(String(requestedUrl)).toBe(layer.url)
    const body = new URLSearchParams(String(request?.body))
    expect(request).toMatchObject({ method: 'POST' })
    expect(body.get('geometryType')).toBe('esriGeometryPolygon')
    expect(JSON.parse(body.get('geometry')!)).toMatchObject({
      spatialReference: { wkid: 4326 },
    })
  })

  it('marca la consulta incompleta si una capa oficial falla', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('timeout')
    })
    const result = await new IdegAffectAdapter(fetcher, 1000, () => new Date(), [
      layer,
    ]).findAffects({
      coordinates: { lat: 43.37, lng: -8.4 },
    })
    expect(result.warnings.map((warning) => warning.code)).toContain('affect_sources_unavailable')
  })

  it('no convierte una respuesta malformada en ausencia de afecciones', async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
    )
    const result = await new IdegAffectAdapter(fetcher, 1000, () => new Date(), [
      layer,
    ]).findAffects({ coordinates: { lat: 43.37, lng: -8.4 } })

    expect(result.detected).toEqual([])
    expect(result.canRuleOutUndetectedAffects).toBe(false)
    expect(result.sourceChecks).toContainEqual(
      expect.objectContaining({ source: 'ideg', status: 'malformed' })
    )
  })
})
