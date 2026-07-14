import { describe, expect, it, vi } from 'vitest'

import { CartoCiudadOfficialAdapter } from './CartoCiudadOfficialAdapter'

function response(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('CartoCiudadOfficialAdapter', () => {
  it('conserva múltiples candidatos gallegos para que el resolver no elija silenciosamente', async () => {
    const fetcher = vi.fn(async () =>
      response([
        {
          id: '1',
          comunidadAutonomaCode: '12',
          muni: 'A Coruña',
          muniCode: '15030',
          address: 'RÚA REAL 1',
          lat: 43.37,
          lng: -8.4,
          state: 0,
        },
        {
          id: '2',
          comunidadAutonomaCode: '12',
          muni: 'Oleiros',
          muniCode: '15058',
          address: 'RÚA REAL 1',
          lat: 43.33,
          lng: -8.31,
          state: 0,
        },
        { id: '3', comunidadAutonomaCode: '13', muni: 'Madrid', state: 0 },
      ])
    )
    const candidates = await new CartoCiudadOfficialAdapter(fetcher).geocode('Rúa Real 1')
    expect(candidates.map((candidate) => candidate.municipalityCode)).toEqual(['15030', '15058'])
    expect(candidates.every((candidate) => candidate.evidence[0].source === 'cartociudad')).toBe(true)
  })

  it('interpreta una geocodificación inversa oficial', async () => {
    const fetcher = vi.fn(async () =>
      response({
        id: '1',
        comunidadAutonomaCode: '12',
        province: 'A Coruña',
        provinceCode: '15',
        muni: 'A Coruña',
        muniCode: '15030',
        address: 'AV PEDRO BARRIE MAZA 19',
        lat: 43.371,
        lng: -8.404,
        refCatastral: '8424001NJ4082S',
        state: 0,
      })
    )
    const candidate = await new CartoCiudadOfficialAdapter(fetcher).reverse({
      lat: 43.371,
      lng: -8.404,
    })
    expect(candidate).toMatchObject({
      municipalityCode: '15030',
      cadastralReference: '8424001NJ4082S',
    })
  })

  it('rechaza una respuesta malformada de candidatos', async () => {
    const fetcher = vi.fn(async () => response({ candidate: 'not-an-array' }))
    await expect(new CartoCiudadOfficialAdapter(fetcher).geocode('Rúa Real')).rejects.toMatchObject({
      kind: 'malformed',
    })
  })
})
