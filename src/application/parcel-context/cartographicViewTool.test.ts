import { afterEach, describe, expect, it, vi } from 'vitest'
import { cartographicToolLimit, parseCartographicArguments } from './cartographicViewTool'
import { accreditedRealityReasonerResponseSchema, buildAccreditedRealityContinuationPrompt, parseAccreditedRealityModelResponse } from './accreditedRealityTool'

const bbox = { minLat: 42, minLng: -9, maxLat: 42.1, maxLng: -8.9 }
const acquire = { operation: 'acquire', representation: 'pair', bbox, width: 64, height: 64 }
afterEach(() => vi.unstubAllEnvs())
describe('cartographic tool protocol', () => {
  it('accepts flexible extents and dispatches a typed cartographic action', () => {
    for (const box of [bbox, { ...bbox, minLat: 41.9 }, { ...bbox, maxLng: -8.7 }]) {
      expect(parseAccreditedRealityModelResponse(JSON.stringify({ action: 'tool_call', toolName: 'get_cartographic_view', toolArguments: { ...acquire, bbox: box } }))).toEqual({ action: 'tool_call', toolName: 'get_cartographic_view', arguments: { ...acquire, bbox: box } })
    }
    expect(accreditedRealityReasonerResponseSchema.properties.toolName.anyOf[0].enum).toContain('get_cartographic_view')
    expect(accreditedRealityReasonerResponseSchema.type).toBe('object')
  })
  it('rejects URLs, foreign context fields, invalid extents, resolution and shear', () => {
    for (const value of [{ ...acquire, url: 'https://evil.invalid' }, { ...acquire, instrumentId: 'other' }, { ...acquire, bbox: { ...bbox, maxLat: 42 } }, { ...acquire, width: 20000 }, { ...acquire, bbox: { ...bbox, minLat: NaN } }, { ...acquire, bbox: { ...bbox, maxLng: 180 } }]) expect(parseCartographicArguments(value)).toBeNull()
    const render = { operation: 'render_alignment', sourceViewId: `cartographic-view:${'a'.repeat(64)}`, referenceViewId: `cartographic-view:${'b'.repeat(64)}`, bbox, width: 64, height: 64, transform: { sourcePixelPivot: { x: 0, y: 0 }, targetPixelPivot: { x: 0, y: 0 }, rotationDegrees: 20, scaleX: 1, scaleY: 2 }, opacity: 0.5, phase: 'provisional' }
    expect(parseCartographicArguments(render)).not.toBeNull()
    expect(parseCartographicArguments({ ...render, transform: { ...render.transform, scaleX: -1 } })).toBeNull()
    expect(parseCartographicArguments({ ...render, transform: { ...render.transform, shear: 0.2 } })).toBeNull()
  })
  it('lists view references in metadata-only continuation history', () => {
    const id = `cartographic-view:${'a'.repeat(64)}`
    const action = parseAccreditedRealityModelResponse(JSON.stringify({ action: 'tool_call', toolName: 'get_cartographic_view', toolArguments: acquire }))!
    const prompt = buildAccreditedRealityContinuationPrompt({ systemPrompt: 'observe', userPrompt: 'question' }, [{ request: action, result: { toolName: 'get_cartographic_view', status: 'available', views: [{ id } as never], limitations: [] } }])
    expect(prompt.userPrompt).toContain(id)
    expect(prompt.userPrompt).not.toContain('base64')
  })
  it('bounds the configurable global cartographic quota', () => {
    vi.stubEnv('URBANBRAIN_ACCREDITED_CARTOGRAPHIC_MAX_TOOL_CALLS', '8')
    expect(cartographicToolLimit()).toBe(8)
    vi.stubEnv('URBANBRAIN_ACCREDITED_CARTOGRAPHIC_MAX_TOOL_CALLS', '1000')
    expect(cartographicToolLimit()).toBe(12)
  })
})
