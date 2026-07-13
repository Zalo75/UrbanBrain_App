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
})
