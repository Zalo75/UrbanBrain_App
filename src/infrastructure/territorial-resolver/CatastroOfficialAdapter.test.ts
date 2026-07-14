import { describe, expect, it, vi } from 'vitest'

import {
  CatastroOfficialAdapter,
  parseCatastroGeometry,
} from './CatastroOfficialAdapter'

const GML = `<?xml version="1.0"?>
<FeatureCollection numberMatched="1" numberReturned="1" xmlns:gml="http://www.opengis.net/gml/3.2">
  <gml:Surface><gml:patches><gml:PolygonPatch><gml:exterior><gml:LinearRing>
    <gml:posList srsDimension="2" count="4">43.37 -8.41 43.37 -8.40 43.38 -8.40 43.37 -8.41</gml:posList>
  </gml:LinearRing></gml:exterior></gml:PolygonPatch></gml:patches></gml:Surface>
</FeatureCollection>`

function json(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('CatastroOfficialAdapter', () => {
  it('interpreta el orden de ejes del GML oficial como latitud/longitud', () => {
    expect(parseCatastroGeometry(GML)?.coordinates[0][0][0]).toEqual([-8.41, 43.37])
  })

  it('combina datos, centro y geometría oficiales por RC', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('Consulta_DNPRC')) {
        return json({
          consulta_dnprcResult: {
            lrcdnp: {
              rcdnp: [
                {
                  dt: {
                    loine: { cp: '15', cm: '30' },
                    np: 'A CORUÑA',
                    nm: 'A CORUÑA',
                    locs: { lous: { lourb: { dir: { tv: 'AV', nv: 'PEDRO BARRIE', pnp: '19' } } } },
                  },
                },
              ],
            },
          },
        })
      }
      if (url.includes('Consulta_CPMRC')) {
        return json({
          Consulta_CPMRCResult: {
            coordenadas: {
              coord: [
                {
                  geo: { xcen: '-8.404096', ycen: '43.371045' },
                  ldt: 'AV PEDRO BARRIE MAZA 19 A CORUÑA',
                },
              ],
            },
          },
        })
      }
      return new Response(GML, { status: 200 })
    })
    const adapter = new CatastroOfficialAdapter(fetcher, 1000, () => new Date('2026-07-13'))

    const result = await adapter.resolveReference('8424001NJ4082S0001AY')

    expect(result).toMatchObject({
      cadastralReference: '8424001NJ4082S',
      normalizedAddress: 'AV PEDRO BARRIE MAZA 19 A CORUÑA',
      municipalityCode: '15030',
      coordinates: { lat: 43.371045, lng: -8.404096 },
    })
    expect(result?.geometry?.type).toBe('MultiPolygon')
    expect(result?.evidence).toHaveLength(3)
  })

  it('devuelve null cuando Catastro informa que no hay RC para el punto', async () => {
    const fetcher = vi.fn(async () =>
      json({ Consulta_RCCOORResult: { control: { cuerr: 1 }, lerr: [{ cod: '16' }] } })
    )
    const result = await new CatastroOfficialAdapter(fetcher).resolveCoordinates({
      lat: 43.371,
      lng: -8.405,
    })
    expect(result).toBeNull()
  })

  it('extrae la RC de una consulta por coordenadas', async () => {
    const fetcher = vi.fn(async () =>
      json({
        Consulta_RCCOORResult: {
          coordenadas: { coord: [{ pc: { pc1: '8424001', pc2: 'NJ4082S' } }] },
        },
      })
    )
    const result = await new CatastroOfficialAdapter(fetcher).resolveCoordinates({
      lat: 43.371,
      lng: -8.404,
    })
    expect(result).toBe('8424001NJ4082S')
  })
})
