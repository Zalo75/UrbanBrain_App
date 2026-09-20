// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { CartographicViewEvidence } from './cartographicViewEvidence'
import { encodePng } from './parcelMapOverlay'
import type { CartographicViewArguments } from '@/application/parcel-context/cartographicViewTool'

const bbox = { minLat: 42, minLng: -9, maxLat: 42.1, maxLng: -8.9 }
const args: CartographicViewArguments = { operation: 'acquire', representation: 'pair', bbox, width: 64, height: 64 }
const context = { expedienteId: 'exp-a', municipalityCode: '15000', instrumentId: '99999', planning: { status: 'determined' as const, applicableInstruments: [{ id: '99999', name: 'Plan', status: 'current' as const }], documents: [], evidence: [], warnings: [] } }
const png = encodePng(64, 64, new Uint8Array(64 * 64 * 4).fill(255))
function fetcher() {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input))
    if (url.searchParams.get('REQUEST') === 'GetCapabilities') return new Response('<Layer><Name>_15000_PXOM_200204_AD_PORD_02CL_99999</Name></Layer>')
    return new Response(png, { headers: { 'content-type': 'image/png' } })
  })
}
describe('authorized cartographic evidence', () => {
  it('acquires paired official maps with exact axis order, metadata and cached immutable bytes', async () => {
    const network = fetcher(), evidence = new CartographicViewEvidence(context, network)
    const result = await evidence.execute(args)
    expect(result.status).toBe('available')
    expect(result.views.map(view => view.kind)).toEqual(['historical', 'modern'])
    const modern = result.views[1]!
    const url = new URL(modern.sourceUrl!)
    expect(url.origin).toBe('https://www.ign.es')
    expect(url.searchParams.get('LAYERS')).toBe('IGNBaseTodo-nofondo')
    expect(url.searchParams.get('BBOX')).toBe('42,-9,42.1,-8.9')
    expect(modern).toMatchObject({ expedienteId: 'exp-a', municipalityCode: '15000', instrumentId: '99999', width: 64, height: 64, provenanceKind: 'official_wms_view', parentViewIds: [], spatialFrameApplicable: true })
    expect(modern.checksum).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(result)).not.toContain('base64')
    expect(evidence.attachments(result)[0]!.data).toBe(png.toString('base64'))
    const calls = network.mock.calls.length
    expect((await evidence.execute(args)).views).toEqual(result.views)
    expect(network).toHaveBeenCalledTimes(calls)
  })

  it('retries a modern cartographic WMS acquisition up to three attempts after transient failures', async () => {
    const timeout = () => Object.assign(new Error('timeout'), { name: 'TimeoutError' })
    const network = vi.fn()
      .mockRejectedValueOnce(timeout())
      .mockRejectedValueOnce(timeout())
      .mockResolvedValueOnce(new Response(png, { headers: { 'content-type': 'image/png' } }))

    const evidence = new CartographicViewEvidence(context, network)
    const result = await evidence.execute({ ...args, representation: 'modern' })

    expect(result.status).toBe('available')
    expect(result.views).toHaveLength(1)
    expect(network).toHaveBeenCalledTimes(3)
  })
  it('fails closed without current authorized inputs or with foreign turn IDs', async () => {
    const network = fetcher()
    expect((await new CartographicViewEvidence({ ...context, instrumentId: 'other' }, network).execute(args)).status).toBe('unavailable')
    expect(network).not.toHaveBeenCalled()
    const first = new CartographicViewEvidence(context, network)
    const views = (await first.execute(args)).views
    const second = new CartographicViewEvidence({ ...context, expedienteId: 'exp-b' }, network)
    const request: CartographicViewArguments = { operation: 'render_alignment', sourceViewId: views[0]!.id, referenceViewId: views[1]!.id, bbox, width: 64, height: 64, transform: { sourcePixelPivot: { x: 0, y: 0 }, targetPixelPivot: { x: 0, y: 0 }, rotationDegrees: 0, scaleX: 1, scaleY: 1 }, opacity: 0.5, phase: 'provisional' }
    expect((await second.execute(request)).status).toBe('error')
  })
  it('lets Luna correct a hypothesis and freeze before independent viewport inspection', async () => {
    const evidence = new CartographicViewEvidence(context, fetcher())
    const views = (await evidence.execute(args)).views
    const request: CartographicViewArguments = { operation: 'render_alignment', sourceViewId: views[0]!.id, referenceViewId: views[1]!.id, bbox, width: 64, height: 64, transform: { sourcePixelPivot: { x: 0, y: 0 }, targetPixelPivot: { x: 1, y: 2 }, rotationDegrees: 0, scaleX: 1, scaleY: 1 }, opacity: 0.5, phase: 'provisional' }
    const provisional = (await evidence.execute(request)).views[1]!
    const frozen = (await evidence.execute({ ...request, phase: 'freeze' })).views[1]!
    expect(frozen.alignment!.id).toBe(provisional.alignment!.id)
    const inspect = (await evidence.execute({ ...request, bbox: { ...bbox, minLat: 41.95 }, opacity: 1 })).views[1]!
    expect(inspect.alignment).toMatchObject({ id: frozen.alignment!.id, phase: 'freeze', transform: request.transform })
    const corrected = (await evidence.execute({ ...request, transform: { ...request.transform, rotationDegrees: 2 } })).views[1]!
    expect(corrected.alignment!.id).not.toBe(frozen.alignment!.id)
    expect(corrected.alignment!.phase).toBe('provisional')
    expect(frozen.alignment!.transform).toEqual(request.transform)
    expect(frozen.parentViewIds).toContain(request.sourceViewId)
  })
  it('reports partial acquisition and rejects XML exceptions, wrong resolution and non-PORD fallback', async () => {
    for (const bad of [new Response('<ServiceException/>', { headers: { 'content-type': 'text/xml' } }), new Response(encodePng(2, 2, new Uint8Array(16)), { headers: { 'content-type': 'image/png' } })]) {
      const evidence = new CartographicViewEvidence(context, async input => String(input).includes('GetCapabilities') ? new Response('<Layer><Name>_15000_PXOM_200204_AD_PORD_02CL_99999</Name></Layer>') : bad.clone())
      expect((await evidence.execute(args)).views).toHaveLength(0)
    }
    const evidence = new CartographicViewEvidence(context, async input => String(input).includes('GetCapabilities') ? new Response('<Layer><Name>_15000_PXOM_200204_AD_PORD_02CL_TILEINDEX_99999</Name></Layer>') : new Response(png, { headers: { 'content-type': 'image/png' } }))
    const partial = await evidence.execute(args)
    expect(partial.views.map(view => view.kind)).toEqual(['modern'])
    expect(partial.limitations.join(' ')).toContain('TILEINDEX')
  })
  it('rejects misleading PNG content and oversized declared payloads', async () => {
    for (const bad of [
      new Response('<ServiceException/>', { headers: { 'content-type': 'image/png' } }),
      new Response(png, { headers: { 'content-type': 'image/png', 'content-length': String(13 * 1024 * 1024) } }),
    ]) {
      const evidence = new CartographicViewEvidence(context, async () => bad.clone())
      const result = await evidence.execute({ ...args, representation: 'modern' })
      expect(result.status).toBe('unavailable')
      expect(result.views).toEqual([])
      expect(result.limitations).not.toEqual([])
    }
  })
  it('propagates parent cancellation without performing retries', async () => {
    const abort = new AbortController()
    abort.abort()
    const network = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => { init?.signal?.throwIfAborted(); return new Response(png, { headers: { 'content-type': 'image/png' } }) })
    const evidence = new CartographicViewEvidence({ ...context, signal: abort.signal }, network)
    await expect(evidence.execute({ ...args, representation: 'modern' })).rejects.toThrow()
    expect(network).toHaveBeenCalledTimes(1)
  })
})
