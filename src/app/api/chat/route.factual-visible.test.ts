import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

import type { NormalizedParcelContext } from '@/domain/parcel-context/types'
import type { UrbanisticFactStatus, UrbanisticRegimeFacts } from '@/domain/territorial-resolver/types'
import type { TerritorialShadowResult } from '@/application/parcel-context/shadow/shadowPipeline'

const mocks = vi.hoisted(() => ({
  context: undefined as NormalizedParcelContext | undefined,
  getExpedienteAccess: vi.fn(),
  loadAuthorizedParcelInputs: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  select: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue(Object.assign(Promise.resolve([]), {
        limit: vi.fn().mockResolvedValue([]),
      })),
    }),
  }),
  embedContent: vi.fn(),
  rpc: vi.fn(),
  abortSignal: vi.fn(),
  completionCreate: vi.fn(),
  runFactual: vi.fn(),
  composeFactual: vi.fn(),
  scheduleShadow: vi.fn(),
  persistFactualResult: vi.fn(),
}))

vi.mock('@/application/authorization/expedienteAccess', () => ({
  getExpedienteAccess: mocks.getExpedienteAccess,
}))
vi.mock('@/infrastructure/db/parcelContextRepository', () => ({
  loadAuthorizedParcelInputs: mocks.loadAuthorizedParcelInputs,
}))
vi.mock('@/application/parcel-context/normalizeParcelContext', () => ({
  buildNormalizedParcelContext: vi.fn(() => mocks.context),
  trustedMunicipalityCodeFilter: vi.fn(() => '15075'),
}))
vi.mock('@/infrastructure/db/client', () => ({
  db: { insert: mocks.insert, select: mocks.select },
}))
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() { return { embedContent: mocks.embedContent } }
  },
  TaskType: { RETRIEVAL_QUERY: 'RETRIEVAL_QUERY' },
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ rpc: mocks.rpc })),
}))
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: mocks.completionCreate } }
  },
}))
vi.mock('@/application/parcel-context/shadow/shadowPipeline', () => ({
  runTerritorialFactualShadowPipeline: mocks.runFactual,
}))
vi.mock('@/application/parcel-context/shadow/factualComposer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/application/parcel-context/shadow/factualComposer')>()
  return { ...actual, composeValidatedFactualAnswer: mocks.composeFactual }
})
vi.mock('@/application/parcel-context/shadow/shadowIntegration', () => ({
  scheduleFactualShadowPipeline: mocks.scheduleShadow,
  scheduleFactualShadowResultPersistence: mocks.persistFactualResult,
}))

import { resetChatRequestGuardForTests } from '@/application/chat/chatRequestGuard'
import { POST } from './route'

function facts(
  categoryStatus: UrbanisticFactStatus,
  categories: Array<{ code: string; label: string; percentage?: number }>
): UrbanisticRegimeFacts {
  return {
    classification: {
      value: { code: 'SNR', label: 'Suelo de núcleo rural' },
      status: categoryStatus === 'conflict' ? 'automatic_confirmed' : categoryStatus,
      origin: categoryStatus === 'manual_review_required' ? 'technician_selection' : 'spatial_intersection',
      confidence: categoryStatus === 'manual_review_required' ? 'medium' : 'high',
      evidence: [], warnings: [], discrepancies: [], nextAction: 'none',
    },
    category: categories.length === 1
      ? {
          value: { code: categories[0].code, label: categories[0].label },
          status: categoryStatus,
          origin: categoryStatus === 'manual_review_required' ? 'technician_selection' : 'spatial_intersection',
          confidence: categoryStatus === 'manual_review_required' ? 'medium' : 'high',
          evidence: [], warnings: [], discrepancies: [], nextAction: 'none',
        }
      : {
          status: categoryStatus,
          candidates: categories.map((category) => ({
            value: { code: category.code, label: category.label },
            label: category.label,
            parcelPercentage: category.percentage,
          })),
          origin: 'spatial_intersection',
          confidence: 'high', evidence: [], warnings: [], discrepancies: [], nextAction: 'none',
        },
    consolidation: {
      status: 'not_available', confidence: 'unknown', evidence: [], warnings: [],
      discrepancies: [], nextAction: 'none',
    },
  }
}

function territorialContext(): NormalizedParcelContext {
  return {
    municipality: {
      value: { name: 'Sada', ineCode: '15075' }, source: 'catastro', confidence: 1,
      verification: 'confirmed',
    },
    urbanisticFacts: facts('manual_review_required', [
      { code: 'SNRC', label: 'Núcleo Rural Común' },
    ]),
    parcelUrbanisticFacts: facts('conflict', [
      { code: 'SNRC', label: 'Núcleo Rural Común', percentage: 98.53 },
      { code: 'SNRT', label: 'Núcleo Rural Tradicional', percentage: 1.47 },
    ]),
    actionArea: {
      value: {
        id: 'area-1',
        geometry: { type: 'MultiPolygon', coordinates: [], crs: 'EPSG:4326' },
        surfaceSquareMetres: 1764.22,
        parcelSurfaceSquareMetres: 1790.46,
        selectionType: 'detected_zone',
        classification: 'SNR',
        category: 'SNRC',
        source: 'manual',
        confidence: 'medium',
        selectedBy: 'user-1',
        selectedAt: '2026-08-13T10:00:00.000Z',
        verification: 'unresolved',
      },
      source: 'manual', confidence: 0.75, verification: 'unverified',
    },
    parcelSurfaceSquareMetres: 1790.46,
    knownConstraints: [], conflicts: [], pendingValidation: [],
  }
}

function validResult(answer: string, operations: NonNullable<TerritorialShadowResult['structuredOutput']>['operations']): TerritorialShadowResult {
  return {
    status: 'valid',
    structuredOutput: { operations, abstentions: [] },
    validation: { valid: true, errors: [] },
    renderedText: [answer],
    diagnostics: {
      latencyMs: 20,
      model: 'deepseek-v4-flash',
      metrics: {
        factCount: operations.length,
        candidateCount: 0,
        coverageRequiredCount: operations.length,
        coverageSelectedCount: operations.length,
        coverageAddedCount: 0,
        coverageComplete: true,
        coverageReason: 'already_complete',
      },
    },
  }
}

async function execute(message: string) {
  const request = new NextRequest('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expedienteId: 'exp-1', message }),
  })
  const response = await POST(request)
  return { response, payload: await response.json() }
}

describe('POST /api/chat synchronous factual visibility', () => {
  const originalSyncFlag = process.env.URBANBRAIN_SYNC_FACTUAL_ENABLED
  const originalComposerFlag = process.env.URBANBRAIN_FACTUAL_COMPOSER_ENABLED

  beforeEach(() => {
    vi.clearAllMocks()
    resetChatRequestGuardForTests()
    mocks.context = territorialContext()
    mocks.insert.mockReturnValue({ values: mocks.values })
    mocks.values.mockResolvedValue(undefined)
    mocks.getExpedienteAccess.mockResolvedValue({
      ok: true,
      userId: 'user-1',
      orgId: 'org-1',
      expediente: { id: 'exp-1', orgId: 'org-1' },
    })
    mocks.loadAuthorizedParcelInputs.mockResolvedValue({ expediente: {}, userMessages: [] })
    mocks.embedContent.mockResolvedValue({ embedding: { values: new Array(768).fill(0.01) } })
    mocks.rpc.mockReturnValue({ abortSignal: mocks.abortSignal })
    mocks.abortSignal.mockResolvedValue({ data: [], error: null })
    mocks.completionCreate.mockResolvedValue({ choices: [{ message: { content: 'Primary Response' } }] })
    mocks.composeFactual.mockResolvedValue({
      answer: 'RESPUESTA COMPUESTA',
      diagnostics: {
        totalMs: 120, providerMs: 100, inputTokens: 300, outputTokens: 90,
        status: 'composed', fallbackUsed: false, fallbackReason: null,
        model: 'deepseek-v4-flash',
      },
    })
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    if (originalSyncFlag === undefined) delete process.env.URBANBRAIN_SYNC_FACTUAL_ENABLED
    else process.env.URBANBRAIN_SYNC_FACTUAL_ENABLED = originalSyncFlag
    if (originalComposerFlag === undefined) delete process.env.URBANBRAIN_FACTUAL_COMPOSER_ENABLED
    else process.env.URBANBRAIN_FACTUAL_COMPOSER_ENABLED = originalComposerFlag
    vi.restoreAllMocks()
  })

  it.each(['false', 'TRUE', '1'])('keeps current Primary behavior when the flag is %s', async (flag) => {
    process.env.URBANBRAIN_SYNC_FACTUAL_ENABLED = flag

    const { payload } = await execute('¿Qué categoría tiene el área seleccionada?')

    expect(mocks.runFactual).not.toHaveBeenCalled()
    expect(mocks.scheduleShadow).toHaveBeenCalledTimes(1)
    expect(payload.answer).not.toContain('RESPUESTA FACTUAL VISIBLE')
  })

  it.each(['false', 'TRUE', '1'])('keeps the factual renderer byte-for-byte when Composer flag is %s', async (flag) => {
    process.env.URBANBRAIN_SYNC_FACTUAL_ENABLED = 'true'
    process.env.URBANBRAIN_FACTUAL_COMPOSER_ENABLED = flag
    const rendered = 'RESPUESTA FACTUAL EXACTA'
    mocks.runFactual.mockResolvedValueOnce(validResult(rendered, [{
      operation: 'state_label',
      factRef: { type: 'category', scope: 'actionArea', code: 'SNRC' },
      label: 'Núcleo Rural Común',
    }]))

    const { payload } = await execute('¿Qué categoría tiene el área seleccionada?')

    expect(payload.answer).toBe(rendered)
    expect(mocks.composeFactual).not.toHaveBeenCalled()
  })

  it.each([
    ['¿Qué categoría urbanística tiene exactamente el área que tengo seleccionada en el visor?', 'category'],
    ['¿Qué clasificación tiene el área seleccionada?', 'classification'],
  ])('serves actionArea %s from the factual renderer', async (message, factType) => {
    process.env.URBANBRAIN_SYNC_FACTUAL_ENABLED = 'true'
    mocks.runFactual.mockResolvedValueOnce(validResult(
      'El área de actuación seleccionada está identificada como Suelo de núcleo rural (SNR), categoría Núcleo Rural Común (SNRC).',
      [
        { operation: 'state_label', factRef: { type: 'classification', scope: 'actionArea' }, label: 'Suelo de núcleo rural' },
        { operation: 'state_label', factRef: { type: 'category', scope: 'actionArea', code: 'SNRC' }, label: 'Núcleo Rural Común' },
      ]
    ))

    const { payload } = await execute(message)

    expect(payload.answer).toContain('área de actuación seleccionada')
    expect(payload.answer).toContain('SNRC')
    expect(mocks.runFactual).toHaveBeenCalledTimes(1)
    const pipelineContract = mocks.runFactual.mock.calls[0][1]
    expect(pipelineContract.factsByScope.actionArea.categories[0].code).toBe('SNRC')
    expect(factType).toMatch(/category|classification/)
  })

  it.each([
    '¿Qué categoría tiene esta zona?',
    '¿Cuál es la categoría del área marcada?',
  ])('serves the short actionArea variant without Primary or parcel leakage: %s', async (message) => {
    process.env.URBANBRAIN_SYNC_FACTUAL_ENABLED = 'true'
    process.env.URBANBRAIN_FACTUAL_COMPOSER_ENABLED = 'false'
    const rendered = 'El área seleccionada está identificada como SNR, categoría SNRC.'
    mocks.runFactual.mockResolvedValueOnce(validResult(rendered, [
      { operation: 'state_label', factRef: { type: 'classification', scope: 'actionArea' }, label: 'Suelo de núcleo rural' },
      { operation: 'state_label', factRef: { type: 'category', scope: 'actionArea', code: 'SNRC' }, label: 'Núcleo Rural Común' },
    ]))

    const { payload } = await execute(message)

    expect(payload).toMatchObject({ answer: rendered, sources: [] })
    expect(mocks.runFactual).toHaveBeenCalledTimes(1)
    expect(mocks.embedContent).not.toHaveBeenCalled()
    expect(mocks.completionCreate).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(payload.answer).not.toContain('SNRT')
  })

  it('serves parcel multicategory percentages without mixing actionArea or rounding dominance to 100', async () => {
    process.env.URBANBRAIN_SYNC_FACTUAL_ENABLED = 'true'
    mocks.runFactual.mockResolvedValueOnce(validResult(
      'Núcleo Rural Común (SNRC) representa el 98,53 % de la parcela y es la de mayor presencia geométrica.\n\nNúcleo Rural Tradicional (SNRT) representa el 1,47 % de la parcela.\n\nLa categoría en toda la parcela presenta un conflicto pendiente de resolución.',
      [
        { operation: 'state_percentage', factRef: { type: 'category', scope: 'parcel', code: 'SNRC' }, percentage: 98.53 },
        { operation: 'state_geometric_dominance', factRef: { type: 'category', scope: 'parcel', code: 'SNRC' } },
        { operation: 'state_percentage', factRef: { type: 'category', scope: 'parcel', code: 'SNRT' }, percentage: 1.47 },
        { operation: 'state_conflict', factRef: { type: 'category', scope: 'parcel', code: 'SNRC' } },
      ]
    ))

    const { payload } = await execute(
      '¿Qué categorías urbanísticas existen en la parcela catastral completa, independientemente del área que tengo seleccionada?'
    )

    expect(payload.answer).toContain('98,53 %')
    expect(payload.answer).toContain('1,47 %')
    expect(payload.answer).toContain('mayor presencia geométrica')
    expect(payload.answer).toContain('conflicto pendiente')
    expect(payload.answer).not.toContain('100')
    expect(payload.answer).not.toContain('efectiv')
    const pipelineContract = mocks.runFactual.mock.calls[0][1]
    expect(pipelineContract.factsByScope.parcel.categories.map((item: { code: string }) => item.code))
      .toEqual(['SNRC', 'SNRT'])
    expect(pipelineContract.factsByScope.actionArea.categories.map((item: { code: string }) => item.code))
      .toEqual(['SNRC'])
  })

  it('serves Valdoviño full coverage percentage factually without Primary', async () => {
    process.env.URBANBRAIN_SYNC_FACTUAL_ENABLED = 'true'
    process.env.URBANBRAIN_FACTUAL_COMPOSER_ENABLED = 'false'
    const rendered = 'La categoría SNRSC afecta a toda la parcela: corresponde al 100 % de la superficie analizada.'
    mocks.runFactual.mockResolvedValueOnce(validResult(rendered, [{
      operation: 'state_coverage', coverage: 'full',
      factRef: { type: 'category', scope: 'parcel', code: 'SNRSC' },
    }]))

    const { payload } = await execute('¿Qué porcentaje de toda la parcela corresponde a SNRSC?')

    expect(payload).toMatchObject({ answer: rendered, sources: [] })
    expect(mocks.runFactual).toHaveBeenCalledTimes(1)
    expect(mocks.embedContent).not.toHaveBeenCalled()
    expect(mocks.completionCreate).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(payload.answer).not.toMatch(/scope|actionArea|coverage|automatic_confirmed/i)
  })

  it.each([
    '¿Qué categorías existen en toda la parcela?',
    '¿Qué categorías tiene la parcela?',
    '¿Toda la parcela tiene la misma categoría?',
  ])('serves the short parcel variant without entering Primary: %s', async (message) => {
    process.env.URBANBRAIN_SYNC_FACTUAL_ENABLED = 'true'
    process.env.URBANBRAIN_FACTUAL_COMPOSER_ENABLED = 'false'
    const rendered = 'SNRC representa el 98,53 % de la parcela y predomina.\n\nSNRT representa el 1,47 %.'
    mocks.runFactual.mockResolvedValueOnce(validResult(rendered, [
      { operation: 'state_percentage', factRef: { type: 'category', scope: 'parcel', code: 'SNRC' }, percentage: 98.53 },
      { operation: 'state_geometric_dominance', factRef: { type: 'category', scope: 'parcel', code: 'SNRC' } },
      { operation: 'state_percentage', factRef: { type: 'category', scope: 'parcel', code: 'SNRT' }, percentage: 1.47 },
      { operation: 'state_conflict', factRef: { type: 'category', scope: 'parcel', code: 'SNRC' } },
    ]))

    const { payload } = await execute(message)

    expect(payload).toMatchObject({ answer: rendered, sources: [] })
    expect(mocks.runFactual).toHaveBeenCalledTimes(1)
    expect(mocks.embedContent).not.toHaveBeenCalled()
    expect(mocks.completionCreate).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('does not turn parcel geometric dominance into a categorical yes', async () => {
    process.env.URBANBRAIN_SYNC_FACTUAL_ENABLED = 'true'
    mocks.runFactual.mockResolvedValueOnce(validResult(
      'Núcleo Rural Común (SNRC) representa el 98,53 % de la parcela y es la de mayor presencia geométrica.\n\nNúcleo Rural Tradicional (SNRT) representa el 1,47 % de la parcela.\n\nLa determinación de la categoría en toda la parcela no está resuelta.',
      [
        { operation: 'state_geometric_dominance', factRef: { type: 'category', scope: 'parcel', code: 'SNRC' } },
        { operation: 'state_percentage', factRef: { type: 'category', scope: 'parcel', code: 'SNRT' }, percentage: 1.47 },
        { operation: 'state_determination', factRef: { type: 'category', scope: 'parcel', code: 'SNRC' }, determination: 'unresolved' },
      ]
    ))

    const { payload } = await execute('¿Puedo considerar toda la parcela como Núcleo Rural Común (SNRC)?')

    expect(payload.answer).not.toMatch(/^Sí\b/iu)
    expect(payload.answer).toContain('SNRT')
    expect(payload.answer).toContain('no está resuelta')
  })

  it.each([
    '¿Cuál es la ocupación máxima de NRC-1?',
    '¿Qué retranqueos se aplican?',
    '¿Qué usos permitidos tiene SNRC?',
    '¿Qué materiales puedo usar en fachada?',
    '¿Qué artículo normativo se aplica?',
    'Resume este expediente de forma general.',
  ])('keeps the non-factual question in Primary: %s', async (message) => {
    process.env.URBANBRAIN_SYNC_FACTUAL_ENABLED = 'true'

    const { payload } = await execute(message)

    expect(mocks.runFactual).not.toHaveBeenCalled()
    expect(mocks.scheduleShadow).toHaveBeenCalledTimes(1)
    expect(payload.answer).not.toContain('mayor presencia geométrica')
  })

  it.each([
    ['llm_failed', { status: 'llm_failed', diagnostics: { latencyMs: 10, model: 'deepseek-v4-flash' } }],
    ['validation_failed', {
      status: 'validation_failed',
      validation: {
        valid: false,
        errors: [{
          code: 'STATUS_MISMATCH',
          message: 'PRIVATE_VALIDATION_MESSAGE',
          operation: 'state_unresolved',
          factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
        }],
        warnings: [],
      },
      diagnostics: {
        latencyMs: 10,
        model: 'deepseek-v4-flash',
        rawLlmResponse: 'PRIVATE_MODEL_RESPONSE',
        metrics: {
          factCount: 2,
          candidateCount: 0,
          operationCount: 10,
          validationErrorCount: 1,
          validationErrorCodes: ['STATUS_MISMATCH'],
          validationErrorOperations: [{
            operation: 'state_unresolved',
            factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
          }],
        },
      },
    }],
    ['abstention', validResult('', [])],
    ['empty rendering', validResult('   ', [{ operation: 'state_label', factRef: { type: 'classification', scope: 'actionArea' }, label: 'Suelo de núcleo rural' }])],
    ['coverage incomplete', {
      ...validResult('Respuesta factual incompleta', [{
        operation: 'state_label',
        factRef: { type: 'category', scope: 'actionArea', code: 'SNRC' },
        label: 'Núcleo Rural Común',
      }]),
      diagnostics: {
        latencyMs: 10,
        model: 'deepseek-v4-flash',
        metrics: {
          factCount: 2,
          candidateCount: 0,
          coverageComplete: false,
          coverageReason: 'scope_mismatch',
        },
      },
    }],
  ] as const)('falls back to current Primary behavior on factual %s', async (_case, pipelineResult) => {
    process.env.URBANBRAIN_SYNC_FACTUAL_ENABLED = 'true'
    const result = _case === 'abstention'
      ? { ...pipelineResult, structuredOutput: { operations: [], abstentions: [{ cause: 'unresolved_fact' as const }] } }
      : pipelineResult
    mocks.runFactual.mockResolvedValueOnce(result)

    const { payload } = await execute('¿Qué categoría tiene el área seleccionada?')

    expect(payload.answer).not.toContain('RESPUESTA FACTUAL VISIBLE')
    expect(mocks.scheduleShadow).toHaveBeenCalledTimes(1)
    if (_case === 'abstention') {
      const factualPerfCall = vi.mocked(console.info).mock.calls.find(
        ([label]) => label === '[FactualPerf]'
      )
      expect(factualPerfCall?.[1]).toEqual(expect.objectContaining({
        status: 'valid',
        fallbackUsed: true,
        fallbackReason: 'abstention:unresolved_fact',
      }))
    }
    if (_case === 'coverage incomplete') {
      const factualPerfCall = vi.mocked(console.info).mock.calls.find(
        ([label]) => label === '[FactualPerf]'
      )
      expect(factualPerfCall?.[1]).toEqual(expect.objectContaining({
        status: 'valid',
        fallbackUsed: true,
        fallbackReason: 'coverage:scope_mismatch',
      }))
    }
    if (_case === 'validation_failed') {
      const factualPerfCall = vi.mocked(console.info).mock.calls.find(
        ([label]) => label === '[FactualPerf]'
      )
      expect(factualPerfCall?.[1]).toEqual(expect.objectContaining({
        validationErrorCount: 1,
        validationErrorCodes: ['STATUS_MISMATCH'],
        validationErrorOperations: [{
          operation: 'state_unresolved',
          factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
        }],
      }))
      expect(JSON.stringify(factualPerfCall)).not.toContain('PRIVATE_VALIDATION_MESSAGE')
      expect(JSON.stringify(factualPerfCall)).not.toContain('PRIVATE_MODEL_RESPONSE')
      expect(JSON.stringify(factualPerfCall)).not.toContain('¿Qué categoría tiene')
    }
  })

  it('falls back safely when the factual call throws', async () => {
    process.env.URBANBRAIN_SYNC_FACTUAL_ENABLED = 'true'
    mocks.runFactual.mockRejectedValueOnce(new Error('provider timeout'))

    const { response } = await execute('¿Qué categoría tiene el área seleccionada?')

    expect(response.status).toBe(200)
    expect(mocks.scheduleShadow).toHaveBeenCalledTimes(1)
  })

  it('does not call factual without facts in the requested scope', async () => {
    process.env.URBANBRAIN_SYNC_FACTUAL_ENABLED = 'true'
    mocks.context = {
      municipality: territorialContext().municipality,
      knownConstraints: [], conflicts: [], pendingValidation: [],
    }

    await execute('¿Qué categoría tiene toda la parcela?')

    expect(mocks.runFactual).not.toHaveBeenCalled()
    expect(mocks.scheduleShadow).toHaveBeenCalledTimes(1)
  })

  it('persists one visible factual assistant message, invents no sources and skips Primary and duplicate Shadow', async () => {
    process.env.URBANBRAIN_SYNC_FACTUAL_ENABLED = 'true'
    const rendered = 'El área de actuación seleccionada está identificada como SNR, categoría SNRC.'
    mocks.runFactual.mockResolvedValueOnce(validResult(rendered, [
      { operation: 'state_label', factRef: { type: 'classification', scope: 'actionArea' }, label: 'Suelo de núcleo rural' },
      { operation: 'state_label', factRef: { type: 'category', scope: 'actionArea', code: 'SNRC' }, label: 'Núcleo Rural Común' },
    ]))

    const { payload } = await execute('¿Qué categoría tiene el área seleccionada?')

    expect(payload).toMatchObject({ answer: rendered, sources: [] })
    expect(mocks.embedContent).not.toHaveBeenCalled()
    expect(mocks.completionCreate).not.toHaveBeenCalled()
    expect(mocks.scheduleShadow).not.toHaveBeenCalled()
    expect(mocks.persistFactualResult).toHaveBeenCalledTimes(1)
    expect(mocks.persistFactualResult).toHaveBeenCalledWith(expect.objectContaining({
      query: '¿Qué categoría tiene el área seleccionada?',
      expedienteId: 'exp-1',
      municipalityIne: '15075',
      pipelineVersion: 'L2.6-sync-visible-v1',
    }))
    expect(mocks.values).toHaveBeenCalledTimes(2)
    expect(mocks.values).toHaveBeenNthCalledWith(2, expect.objectContaining({
      role: 'assistant', content: rendered, sources: [],
    }))
    const factualPerfCall = vi.mocked(console.info).mock.calls.find(
      ([label]) => label === '[FactualPerf]'
    )
    expect(factualPerfCall?.[1]).toEqual(expect.objectContaining({
      expedienteId: 'exp-1',
      totalMs: expect.any(Number),
      contextMs: expect.any(Number),
      contractMs: expect.any(Number),
      routingMs: expect.any(Number),
      pipelineMs: expect.any(Number),
      providerMs: expect.any(Number),
      parseMs: expect.any(Number),
      validateMs: expect.any(Number),
      renderMs: expect.any(Number),
      persistMs: expect.any(Number),
      criticalRpcMs: 0,
      status: 'valid',
      fallbackUsed: false,
      requestAborted: false,
    }))
    expect(JSON.stringify(factualPerfCall)).not.toContain(rendered)
    expect(JSON.stringify(factualPerfCall)).not.toContain('¿Qué categoría tiene')
  })

  it('persists and returns the composed answer without Primary, RAG or sources', async () => {
    process.env.URBANBRAIN_SYNC_FACTUAL_ENABLED = 'true'
    process.env.URBANBRAIN_FACTUAL_COMPOSER_ENABLED = 'true'
    const mechanical = 'RESPUESTA MECÁNICA DEL RENDERER'
    const composed = 'No puede considerarse estrictamente que el 100 % de la parcela sea SNRC.\n\nEl 98,53 % es SNRC y el 1,47 % es SNRT.'
    mocks.composeFactual.mockResolvedValueOnce({
      answer: composed,
      diagnostics: {
        totalMs: 121, providerMs: 103, inputTokens: 300, outputTokens: 88,
        status: 'composed', fallbackUsed: false, fallbackReason: null,
        model: 'composer-small',
      },
    })
    mocks.runFactual.mockResolvedValueOnce(validResult(mechanical, [
      { operation: 'state_percentage', factRef: { type: 'category', scope: 'parcel', code: 'SNRC' }, percentage: 98.53 },
      { operation: 'state_geometric_dominance', factRef: { type: 'category', scope: 'parcel', code: 'SNRC' } },
      { operation: 'state_percentage', factRef: { type: 'category', scope: 'parcel', code: 'SNRT' }, percentage: 1.47 },
      { operation: 'state_conflict', factRef: { type: 'category', scope: 'parcel', code: 'SNRC' } },
    ]))

    const { payload } = await execute('¿Puedo considerar toda la parcela como SNRC?')

    expect(payload).toMatchObject({ answer: composed, sources: [] })
    expect(payload.answer).not.toContain(mechanical)
    expect(mocks.composeFactual).toHaveBeenCalledWith(expect.objectContaining({
      question: '¿Puedo considerar toda la parcela como SNRC?',
      fallbackAnswer: mechanical,
      signal: expect.any(AbortSignal),
    }))
    expect(mocks.embedContent).not.toHaveBeenCalled()
    expect(mocks.completionCreate).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.values).toHaveBeenNthCalledWith(2, expect.objectContaining({
      role: 'assistant', content: composed, sources: [],
    }))
    expect(mocks.persistFactualResult).toHaveBeenCalledWith(expect.objectContaining({
      result: expect.objectContaining({ renderedText: [composed] }),
    }))
    const composerPerfCall = vi.mocked(console.info).mock.calls.find(
      ([label]) => label === '[ComposerPerf]'
    )
    expect(composerPerfCall?.[1]).toEqual({
      expedienteId: 'exp-1', totalMs: 121, providerMs: 103,
      inputTokens: 300, outputTokens: 88, status: 'composed',
      fallbackUsed: false, fallbackReason: null, model: 'composer-small',
    })
    expect(JSON.stringify(composerPerfCall)).not.toContain(composed)
    expect(JSON.stringify(composerPerfCall)).not.toContain('¿Puedo considerar')
  })

  it.each([
    [
      '¿Qué categoría tiene exactamente el área seleccionada?',
      'El área seleccionada está identificada como SNR, categoría SNRC. La determinación procede de revisión manual y todavía no está confirmada.',
    ],
    [
      '¿Qué clasificación tiene el área seleccionada?',
      'El área seleccionada está clasificada como SNR. La determinación procede de revisión manual y todavía no está confirmada.',
    ],
  ])('uses a valid Composer answer for the real actionArea case: %s', async (question, composed) => {
    process.env.URBANBRAIN_SYNC_FACTUAL_ENABLED = 'true'
    process.env.URBANBRAIN_FACTUAL_COMPOSER_ENABLED = 'true'
    mocks.composeFactual.mockResolvedValueOnce({
      answer: composed,
      diagnostics: {
        totalMs: 90, providerMs: 75, status: 'composed', fallbackUsed: false,
        fallbackReason: null, model: 'composer-small',
      },
    })
    mocks.runFactual.mockResolvedValueOnce(validResult('RESPUESTA MECÁNICA', [
      { operation: 'state_label', factRef: { type: 'classification', scope: 'actionArea' }, label: 'Suelo de núcleo rural' },
      { operation: 'state_label', factRef: { type: 'category', scope: 'actionArea', code: 'SNRC' }, label: 'Núcleo Rural Común' },
      { operation: 'state_status', factRef: { type: 'category', scope: 'actionArea', code: 'SNRC' }, status: 'manual_review_required' },
      { operation: 'state_determination', factRef: { type: 'category', scope: 'actionArea', code: 'SNRC' }, determination: 'manual' },
    ]))

    const { payload } = await execute(question)

    expect(payload).toMatchObject({ answer: composed, sources: [] })
    expect(mocks.composeFactual).toHaveBeenCalledTimes(1)
    expect(mocks.embedContent).not.toHaveBeenCalled()
    expect(mocks.completionCreate).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('keeps the validated factual renderer when Composer throws unexpectedly', async () => {
    process.env.URBANBRAIN_SYNC_FACTUAL_ENABLED = 'true'
    process.env.URBANBRAIN_FACTUAL_COMPOSER_ENABLED = 'true'
    const rendered = 'RESPUESTA FACTUAL VALIDADA'
    mocks.composeFactual.mockRejectedValueOnce(new Error('PRIVATE_COMPOSER_FAILURE'))
    mocks.runFactual.mockResolvedValueOnce(validResult(rendered, [{
      operation: 'state_label',
      factRef: { type: 'category', scope: 'actionArea', code: 'SNRC' },
      label: 'Núcleo Rural Común',
    }]))

    const { payload } = await execute('¿Qué categoría tiene el área seleccionada?')

    expect(payload).toMatchObject({ answer: rendered, sources: [] })
    expect(mocks.embedContent).not.toHaveBeenCalled()
    expect(mocks.completionCreate).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
    const composerPerfCall = vi.mocked(console.info).mock.calls.find(
      ([label]) => label === '[ComposerPerf]'
    )
    expect(composerPerfCall?.[1]).toEqual(expect.objectContaining({
      status: 'fallback', fallbackUsed: true, fallbackReason: 'unexpected_error',
    }))
    expect(JSON.stringify(composerPerfCall)).not.toContain('PRIVATE_COMPOSER_FAILURE')
    expect(JSON.stringify(composerPerfCall)).not.toContain('¿Qué categoría')
  })
})
