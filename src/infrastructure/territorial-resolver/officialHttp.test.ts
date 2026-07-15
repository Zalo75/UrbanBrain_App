import { describe, expect, it, vi } from 'vitest'

import { fetchOfficial } from './officialHttp'

describe('fetchOfficial retry policy', () => {
  it('reintenta una vez un fallo transitorio y conserva el resultado valido', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))

    const response = await fetchOfficial(
      fetcher,
      'Catastro',
      new URL('https://official.test/query'),
      100,
      {},
      { maxRetries: 1, baseDelayMs: 0 }
    )

    expect(response.status).toBe(200)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('no reintenta errores HTTP semanticos o de entrada', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 400 }))

    await expect(
      fetchOfficial(
        fetcher,
        'SIOTUGA',
        new URL('https://official.test/query'),
        100,
        {},
        { maxRetries: 1, baseDelayMs: 0 }
      )
    ).rejects.toMatchObject({ kind: 'http' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('limita los reintentos aunque el servicio siga caido', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('network unavailable')
    })

    await expect(
      fetchOfficial(
        fetcher,
        'IDEG',
        new URL('https://official.test/query'),
        100,
        {},
        { maxRetries: 1, baseDelayMs: 0 }
      )
    ).rejects.toMatchObject({ kind: 'unavailable' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
