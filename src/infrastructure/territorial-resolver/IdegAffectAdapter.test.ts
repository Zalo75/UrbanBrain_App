import { describe, expect, it, vi } from 'vitest'

import { IdegAffectAdapter } from './IdegAffectAdapter'

const layer = {
  id: 'test-layer',
  category: 'patrimonio_cultural',
  name: 'Contorno de protección',
  url: 'https://ideg.xunta.gal/servizos/rest/services/test/MapServer/1/query',
}

describe('IdegAffectAdapter', () => {
  it('conserva una intersección positiva con evidencia oficial', async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ features: [{ attributes: { OBJECTID: 7, NOMBRE: 'BIC' } }] }), {
        status: 200,
      })
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
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ features: [] }), { status: 200 }))
    const result = await new IdegAffectAdapter(fetcher, 1000, () => new Date(), [layer]).findAffects({
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
    const result = await new IdegAffectAdapter(fetcher, 1000, () => new Date(), [layer]).findAffects({
      coordinates: { lat: 43.37, lng: -8.4 },
    })
    expect(result.warnings.map((warning) => warning.code)).toContain('affect_sources_unavailable')
  })
})
