// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReasonerRequest } from '@/application/chat/reasonerProvider'
const mocks = vi.hoisted(() => ({ access: vi.fn(), load: vi.fn(), generate: vi.fn(), budget: vi.fn(), record: vi.fn(), insert: vi.fn(), name: 'openai' }))
vi.mock('@/infrastructure/db/client', () => ({ db: { insert: () => ({ values: mocks.insert }) } }))
vi.mock('@/application/authorization/expedienteAccess', () => ({ getExpedienteAccess: mocks.access }))
vi.mock('@/infrastructure/db/parcelContextRepository', () => ({ loadAuthorizedParcelInputs: mocks.load }))
vi.mock('@/application/chat/reasonerProvider', () => ({ getReasonerProvider: () => ({ name: mocks.name, generate: mocks.generate }) }))
vi.mock('@/application/runtime/runtimeAccounting', () => ({ assertRuntimeBudgetAvailable: mocks.budget, recordRuntimeCall: mocks.record }))
vi.mock('@/application/parcel-context/normalizeParcelContext', async importOriginal => ({ ...await importOriginal<object>(), buildNormalizedParcelContext: () => ({ conflicts: [], reliability: 'partial', knownConstraints: [], pendingValidation: [] }) }))
vi.mock('@/application/chat/chatRequestGuard', () => ({ acquireChatSlot: () => ({ ok: true, release: vi.fn() }), CHAT_REQUEST_TIMEOUT_MS: 120000, MAX_CHAT_MESSAGE_LENGTH: 4000 }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))
vi.mock('openai', () => ({ default: class {} }))
vi.mock('@/application/parcel-context/accreditedRealityValidation', async importOriginal => {
  const actual = await importOriginal<typeof import('@/application/parcel-context/accreditedRealityValidation')>()
  return { ...actual, validateAccreditedRealityOutput: vi.fn(actual.validateAccreditedRealityOutput) }
})
import { validateAccreditedRealityOutput } from '@/application/parcel-context/accreditedRealityValidation'
import { POST } from './route'
import { NextRequest } from 'next/server'
import { encodePng } from '@/infrastructure/territorial-resolver/parcelMapOverlay'

const bbox = { minLat: 42, minLng: -9, maxLat: 42.1, maxLng: -8.9 }
const acquire = { operation: 'acquire', representation: 'pair', bbox, width: 64, height: 64 }
const response = (value: unknown) => ({ rawContent: JSON.stringify(value), provider: 'openai', model: 'gpt-5.6-luna', latencyMs: 1, inputTokens: 20, outputTokens: 3, totalTokens: 23 })
const final = { action: 'final', toolName: null, toolArguments: {}, answerMode: 'abstain', claims: [], missingFacts: ['comprobación independiente'] }
const request = () => new NextRequest('http://localhost/api/chat', { method: 'POST', body: JSON.stringify({ expedienteId: 'exp-cartography', message: 'Comprueba la superposición territorial.' }) })
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('URBANBRAIN_EXPEDIENTE_ACCREDITED_REALITY_ENABLED', '1')
  vi.stubEnv('URBANBRAIN_REASONER_PROVIDER', 'openai')
  vi.stubEnv('URBANBRAIN_OPENAI_REASONER_MODEL', 'gpt-5.6-luna')
  vi.spyOn(console, 'info').mockImplementation(() => {})
  mocks.name = 'openai'
  mocks.access.mockResolvedValue({ ok: true, userId: 'user-cartography' })
  mocks.insert.mockResolvedValue([])
  mocks.load.mockResolvedValue({ expedienteId: 'exp-cartography', expediente: {}, detected: { municipalityCode: '15000', municipalityName: 'Test', applicableInstruments: [{ id: '99999', name: 'Plan', status: 'current' }], planningDocuments: [] }, constraints: [], conflicts: [], userMessages: [] })
  mocks.record.mockReturnValue({})
  const png = encodePng(64, 64, new Uint8Array(64 * 64 * 4).fill(255))
  vi.stubGlobal('fetch', vi.fn(async input => String(input).includes('GetCapabilities') ? new Response('<Layer><Name>_15000_PXOM_200204_AD_PORD_02CL_99999</Name></Layer>') : new Response(png, { headers: { 'content-type': 'image/png' } })))
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
describe('POST Accredited Reality cartographic loop', () => {
  it('lets the same reasoner acquire, propose, observe, correct, freeze and inspect distributed structure', async () => {
    const transform = { sourcePixelPivot: { x: 0, y: 0 }, targetPixelPivot: { x: 0, y: 0 }, rotationDegrees: 0, scaleX: 1, scaleY: 1 }
    let render: Record<string, unknown>
    mocks.generate.mockImplementation(async (input: ReasonerRequest) => {
      const pass = mocks.generate.mock.calls.length
      if (pass === 1) return response({ action: 'tool_call', toolName: 'get_cartographic_view', toolArguments: acquire })
      if (pass === 2) {
        expect(input.images!.map(image => JSON.parse(image.label.slice(image.label.indexOf('{'))).kind)).toEqual(['historical', 'modern'])
        render = { operation: 'render_alignment', sourceViewId: input.images![0]!.id, referenceViewId: input.images![1]!.id, bbox, width: 64, height: 64, transform, opacity: 0.5, phase: 'provisional' }
      }
      if (pass === 3) render = { ...render, transform: { ...transform, rotationDegrees: 2 } }
      if (pass === 4) render = { ...render, phase: 'freeze' }
      if (pass === 5) render = { ...render, bbox: { ...bbox, minLat: 41.95 } }
      if (pass >= 3) expect(input.images!.some(image => image.label.startsWith('overlay:'))).toBe(true)
      if (pass === 6) return response(final)
      return response({ action: 'tool_call', toolName: 'get_cartographic_view', toolArguments: render! })
    })
    const result = await POST(request())
    const body = await result.json()
    expect(result.status).toBe(200)
    expect(mocks.generate).toHaveBeenCalledTimes(6)
    expect(mocks.budget).toHaveBeenCalledTimes(6)
    expect(mocks.record).toHaveBeenCalledTimes(6)
    const last = mocks.generate.mock.calls[5]![0] as ReasonerRequest
    expect(last.userPrompt).toContain('freeze')
    expect(last.userPrompt).not.toContain('base64')
    expect(last.images![1]!.label).toContain('freeze')
    expect(body.sources.some((source: { source_kind: string }) => source.source_kind === 'cartographic_view')).toBe(true)
    expect(JSON.stringify(mocks.insert.mock.calls)).not.toContain('cartographic-alignment:')
    expect(vi.mocked(validateAccreditedRealityOutput).mock.calls[0]![2].canAnswerConcreteParameters).toBe(false)
  })
  it('does not perform acquisition without expediente access', async () => {
    mocks.access.mockResolvedValue({ ok: false, reason: 'unauthenticated' })
    expect((await POST(request())).status).toBe(401)
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it('stops before a continuation when runtime budget is exhausted', async () => {
    mocks.generate.mockResolvedValue(response({ action: 'tool_call', toolName: 'get_cartographic_view', toolArguments: acquire }))
    mocks.budget.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw Object.assign(new Error('budget'), { name: 'RuntimeBudgetExceeded' }) })
    expect((await POST(request())).status).toBe(429)
    expect(mocks.generate).toHaveBeenCalledTimes(1)
  })
  it('reports exhausted quota as incomplete investigation, not a rejected alignment', async () => {
    vi.stubEnv('URBANBRAIN_ACCREDITED_CARTOGRAPHIC_MAX_TOOL_CALLS', '4')
    mocks.generate.mockResolvedValue(response({ action: 'tool_call', toolName: 'get_cartographic_view', toolArguments: acquire }))
    const result = await POST(request())
    const body = await result.json()
    expect(mocks.generate).toHaveBeenCalledTimes(5)
    expect(body.answer).toContain('Investigación incompleta')
    expect(body.answer).not.toContain('alineación')
    expect(body.answer).not.toContain('ordenanza')
    expect(body.answer).toContain('se alcanzó el límite de herramientas')
  })
})
