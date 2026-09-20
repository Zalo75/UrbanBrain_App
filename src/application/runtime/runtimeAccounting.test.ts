import { describe, expect, it } from 'vitest'
import { estimateRuntimeCostUsd, recordLLMUsage, summarizeLLMUsageEvents } from './runtimeAccounting'

describe('runtime accounting', () => {
  it('estimates input, cached input and output at the configured rate', () => {
    const result = estimateRuntimeCostUsd({
      provider: 'openai',
      model: 'gpt-5.6-luna',
      inputTokens: 1_000_000,
      cachedTokens: 250_000,
      outputTokens: 100_000,
    })
    expect(result.costUsd).toBeCloseTo(0.2 * 0.75 + 0.02 * 0.25 + 1.2 * 0.1)
  })

  it('marks missing pricing or usage as unknown instead of inventing a cost', () => {
    expect(estimateRuntimeCostUsd({ provider: 'unknown', model: 'x', inputTokens: 10 }).costUsd).toBeNull()
    expect(estimateRuntimeCostUsd({ provider: 'openai', model: 'gpt-5.6-luna' }).costUsd).toBeNull()
  })

  it('records usage with nulls and aggregates one operation without double counting cached/reasoning tokens', () => {
    const operationId = `test-${Date.now()}`
    const event = recordLLMUsage({ operationType: 'chat_query', operationId, requestId: operationId, expedienteId: 'exp-1', stage: 'chat', inferenceIndex: 1, provider: 'openai', model: 'gpt-5.6-luna', inputTokens: 100, cachedInputTokens: 25, outputTokens: 40, reasoningTokens: 10, totalTokens: 140, durationMs: 12, toolCallsRequested: 1, finishReason: null })
    expect(event.event).toBe('llm-usage')
    expect(summarizeLLMUsageEvents([event], operationId)).toMatchObject({ operationType: 'chat_query', inferenceCount: 1, inputTokens: 100, cachedInputTokens: 25, outputTokens: 40, reasoningTokens: 10, totalTokens: 140 })
  })

  it('leaves absent usage and pricing as null', () => {
    const operationId = `test-null-${Date.now()}`
    const event = recordLLMUsage({ operationType: 'expediente_generation', operationId, requestId: null, expedienteId: null, stage: 'unknown', inferenceIndex: 1, provider: 'unknown', model: 'unknown', inputTokens: null, cachedInputTokens: null, outputTokens: null, reasoningTokens: null, totalTokens: null, durationMs: null, toolCallsRequested: 0, finishReason: null })
    expect(summarizeLLMUsageEvents([event], operationId).estimatedCostUsd).toBeNull()
    expect(summarizeLLMUsageEvents([event], operationId).inputTokens).toBeNull()
  })
})
