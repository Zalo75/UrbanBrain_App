import { beforeEach, describe, expect, it, vi } from 'vitest'
import { persistShadowEvaluation, type ShadowTelemetryEvent } from './factualShadowEvaluationsRepository'

const mocks = vi.hoisted(() => {
  const m = {
    insert: vi.fn().mockImplementation(() => m),
    values: vi.fn().mockResolvedValue([]),
  }
  return m
})

vi.mock('@/infrastructure/db/client', () => ({ 
  db: { 
    insert: mocks.insert 
  } 
}))

describe('factualShadowEvaluationsRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('persists a valid status with all fields', async () => {
    const event: ShadowTelemetryEvent = {
      expedienteId: 'exp-123',
      municipalityIne: '15078',
      query: 'Is this urban?',
      shadowModel: 'deepseek-v4',
      shadowStatus: 'valid',
      latencyMs: 1200,
      validationErrors: null,
      structuredOutput: { isUrban: true },
      renderedAnswer: 'Yes, it is urban.',
      pipelineVersion: '1.0'
    }

    await persistShadowEvaluation(event)
    
    expect(mocks.insert).toHaveBeenCalled()
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({
      expedienteId: 'exp-123',
      municipalityIne: '15078',
      query: 'Is this urban?',
      shadowModel: 'deepseek-v4',
      shadowStatus: 'valid',
      latencyMs: 1200,
      validationErrors: null,
      structuredOutput: { isUrban: true },
      renderedAnswer: 'Yes, it is urban.',
      pipelineVersion: '1.0'
    }))
  })

  it('allows validation_failed with structured errors', async () => {
    await persistShadowEvaluation({
      query: 'Bad query',
      shadowModel: 'deepseek-v4',
      shadowStatus: 'validation_failed',
      latencyMs: 400,
      validationErrors: { issues: ['missing field'] },
    })

    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({
      shadowStatus: 'validation_failed',
      validationErrors: { issues: ['missing field'] }
    }))
  })

  it('allows render_failed and llm_failed states', async () => {
    await persistShadowEvaluation({
      query: 'Q',
      shadowModel: 'test',
      shadowStatus: 'render_failed',
      latencyMs: 100,
    })
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({ shadowStatus: 'render_failed' }))

    await persistShadowEvaluation({
      query: 'Q',
      shadowModel: 'test',
      shadowStatus: 'llm_failed',
      latencyMs: 100,
    })
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({ shadowStatus: 'llm_failed' }))
  })

  it('handles nullable fields gracefully', async () => {
    await persistShadowEvaluation({
      query: 'Just query',
      shadowModel: 'deepseek',
      shadowStatus: 'valid',
      latencyMs: 200,
      // intentionally omitting expedienteId, municipalityIne, renderedAnswer
    })

    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({
      expedienteId: null,
      municipalityIne: null,
      renderedAnswer: null,
      structuredOutput: null
    }))
  })

  it('fails silently without crashing the production flow', async () => {
    mocks.values.mockRejectedValueOnce(new Error('DB Connection Lost'))

    await expect(persistShadowEvaluation({
      query: 'A',
      shadowModel: 'A',
      shadowStatus: 'valid',
      latencyMs: 10
    })).resolves.toBeUndefined()

    expect(console.warn).toHaveBeenCalledWith(
      '[Telemetry] Failed to persist factual shadow evaluation',
      expect.any(Error)
    )
  })

  it('does not contain any fields for secrets or api keys', () => {
    // Asserting the type constraints by ensuring compilation works
    // and explicitly checking that the payload doesn't map arbitrary keys
    const event: any = {
      query: 'Test',
      shadowModel: 'Test',
      shadowStatus: 'valid',
      latencyMs: 10,
      apiKey: 'SECRET', // Should be ignored by the explicit mapping in the helper
      env: 'SECRET'
    }

    persistShadowEvaluation(event)

    expect(mocks.values).toHaveBeenCalledWith(expect.not.objectContaining({
      apiKey: expect.anything(),
      env: expect.anything()
    }))
  })
})
