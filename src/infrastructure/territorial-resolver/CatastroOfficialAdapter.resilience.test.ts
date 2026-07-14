import { describe, expect, it, vi } from 'vitest'

import { CatastroOfficialAdapter } from './CatastroOfficialAdapter'

function timeoutError() {
  const error = new Error('internal timeout')
  error.name = 'TimeoutError'
  return error
}

describe('CatastroOfficialAdapter resilience', () => {
  it('clasifica un timeout real del transporte', async () => {
    const fetcher = vi.fn(async () => {
      throw timeoutError()
    })

    await expect(
      new CatastroOfficialAdapter(fetcher).resolveReference('8424001NJ4082S')
    ).rejects.toMatchObject({ service: 'Catastro', kind: 'timeout' })
  })

  it('rechaza una respuesta JSON malformada en vez de tratarla como parcela inexistente', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) =>
      String(input).includes('wfsCP')
        ? new Response('<FeatureCollection numberMatched="0"/>', { status: 200 })
        : new Response('{not-json', { status: 200 })
    )

    await expect(
      new CatastroOfficialAdapter(fetcher).resolveReference('8424001NJ4082S')
    ).rejects.toMatchObject({ service: 'Catastro', kind: 'malformed' })
  })

  it('rechaza un JSON con esquema inesperado en vez de tratarlo como no encontrado', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) =>
      String(input).includes('wfsCP')
        ? new Response('<FeatureCollection numberMatched="0"/>', { status: 200 })
        : new Response(JSON.stringify({ status: 'ok', data: [] }), { status: 200 })
    )

    await expect(
      new CatastroOfficialAdapter(fetcher).resolveReference('8424001NJ4082S')
    ).rejects.toMatchObject({ service: 'Catastro', kind: 'malformed' })
  })

  it('conserva una respuesta parcial utilizable y declara la comprobacion incompleta', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('Consulta_DNPRC')) {
        return new Response(
          JSON.stringify({
            consulta_dnprcResult: {
              lrcdnp: {
                rcdnp: {
                  dt: { loine: { cp: '15', cm: '009' }, np: 'A CORUNA', nm: 'BETANZOS' },
                },
              },
            },
          }),
          { status: 200 }
        )
      }
      if (url.includes('Consulta_CPMRC')) throw timeoutError()
      return new Response('<FeatureCollection numberMatched="0"/>', { status: 200 })
    })

    const result = await new CatastroOfficialAdapter(fetcher).resolveReference(
      '8424001NJ4082S'
    )

    expect(result?.municipality).toBe('BETANZOS')
    expect(result?.sourceChecks).toContainEqual(
      expect.objectContaining({ source: 'catastro', status: 'partial' })
    )
  })
})
