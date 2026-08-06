import { describe, expect, it, vi } from 'vitest'

import { SiotugaPlanningKnowledgeSource } from './SiotugaPlanningKnowledgeSource'

const layerName = '_15031_PXOU_198707_AD_3CLAS_22310'

function response(body: string, options?: ResponseInit) {
  return new Response(body, { status: 200, ...options })
}

function fetcherWithInventory(inventoryJson = '[]') {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('REQUEST=GetCapabilities')) {
      return response(
        `<WFS_Capabilities><FeatureType><Name>${layerName}</Name></FeatureType></WFS_Capabilities>`,
        { headers: { 'content-type': 'application/xml' } }
      )
    }
    if (url.includes('REQUEST=DescribeFeatureType')) {
      return response(
        '<schema><element name="cla_homo"/><element name="cat_homo"/></schema>',
        { headers: { 'content-type': 'application/xml' } }
      )
    }
    if (url.includes('inventario.php')) {
      return response('<input id="token" value="ephemeral-token">', {
        headers: { 'set-cookie': 'PHPSESSID=session-value; Path=/; Secure; HttpOnly' },
      })
    }
    if (url.includes('query_document.php')) {
      const body = init?.body as URLSearchParams
      const classId = body.get('idclase')
      return response(classId === '14' ? inventoryJson : '[]', {
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.includes('getIOTPU.php')) {
      const body = init?.body as URLSearchParams
      const iddoc = body.get('iddoc')
      return response(JSON.stringify({
        datos_xerais: { id: iddoc, filesroot: 'root', folder: 'folder' },
        elementos: []
      }), { headers: { 'content-type': 'application/json' } })
    }
    return new Response('not found', { status: 404 })
  }) as unknown as typeof fetch
}

describe('SIOTUGA Planning Knowledge source', () => {
  it('collects capabilities, schemas and the four official inventory classes', async () => {
    const fetcher = fetcherWithInventory(
      JSON.stringify([
        {
          id: '22310',
          docnome: 'PLAN XERAL DE ORDENACIÓN URBANA',
          figura: 'Plan Xeral de Ordenación Urbana',
          fechaaddef: '1987-07-29',
          fechabop: '1988-09-30',
          incidencias_iuris: null,
        },
        {
          id: '23095',
          docnome: 'PXOU NA ORDENANZA 7',
          figura: 'Modificación Puntual',
          fechaaddef: '1991-11-27',
          incidencias_iuris: null,
        },
      ])
    )
    const result = await new SiotugaPlanningKnowledgeSource(fetcher).collectMunicipality(
      '15031',
      '2026-07-29T12:00:00.000Z'
    )

    expect(result.inventory).toContainEqual(
      expect.objectContaining({
        officialId: '22310',
        kind: 'general',
        approvalDate: '1987-07-29',
      })
    )
    expect(result.inventory).toContainEqual(
      expect.objectContaining({ officialId: '23095', kind: 'general_modification' })
    )
    expect(result.layerSchemas[layerName]?.xml).toContain('cla_homo')
    expect(result.rawSources).toHaveLength(8)
    expect(result.rawSources.some((item) => item.content.includes('ephemeral-token'))).toBe(false)
    expect(fetcher).toHaveBeenCalledTimes(9)

    const inventoryCalls = fetcher.mock.calls.filter(([input]) =>
      String(input).includes('query_document.php')
    )
    expect(inventoryCalls).toHaveLength(4)
    for (const [, init] of inventoryCalls) {
      expect(init?.headers).toMatchObject({
        cookie: 'PHPSESSID=session-value',
      })
      expect(String(init?.body)).toContain('token=ephemeral-token')
    }
  })

  it('fails closed when the official inventory response changes contract', async () => {
    const fetcher = fetcherWithInventory('{"unexpected":true}')

    await expect(
      new SiotugaPlanningKnowledgeSource(fetcher).collectMunicipality(
        '15031',
        '2026-07-29T12:00:00.000Z'
      )
    ).rejects.toThrow('array expected')
  })
})

import { parseSiotugaDocumentInventory } from './SiotugaPlanningKnowledgeSource'

describe('parseSiotugaDocumentInventory', () => {
  const baseJson = {
    datos_xerais: {
      id: '123',
      filesroot: 'root',
      folder: 'folder'
    }
  }

  it('keeps current behavior when elementos is an array', () => {
    const json = JSON.stringify({
      ...baseJson,
      elementos: [{
        description: 'PLANOS',
        componentes: [{ pathesperado: '123.pdf', id: '456' }]
      }]
    })
    const result = parseSiotugaDocumentInventory(json, '123', 'source-1')
    expect(result).toHaveLength(1)
    expect(result[0]?.officialDocumentId).toBe('456')
  })

  it('returns empty list and does not fail when elementos is null', () => {
    const json = JSON.stringify({
      ...baseJson,
      elementos: null
    })
    const result = parseSiotugaDocumentInventory(json, '123', 'source-1')
    expect(result).toEqual([])
  })

  it('returns empty list and does not fail when elementos is undefined or missing', () => {
    const json = JSON.stringify(baseJson)
    const result = parseSiotugaDocumentInventory(json, '123', 'source-1')
    expect(result).toEqual([])
  })

  it('throws contract error when elementos is an invalid type', () => {
    const json = JSON.stringify({
      ...baseJson,
      elementos: { "unexpected": "object" }
    })
    expect(() => parseSiotugaDocumentInventory(json, '123', 'source-1')).toThrow('elementos array expected')
  })
})
