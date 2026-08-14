import { describe, expect, it, vi } from 'vitest'
import type OpenAI from 'openai'
import {
  composeValidatedFactualAnswer,
  factualComposerModel,
  isFactualComposerEnabled,
} from './factualComposer'
import { buildFactualComposerEvidence } from './factualComposerEvidence'
import {
  createSadaContract,
  sadaOutput,
  sadaPlan,
} from './factualComposer.testFixtures'

function clientWith(content: string) {
  const create = vi.fn().mockResolvedValue({
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 310, completion_tokens: 96 },
  })
  return { client: { chat: { completions: { create } } } as unknown as OpenAI, create }
}

const baseOptions = () => ({
  question: '¿Puedo considerar toda la parcela como Núcleo Rural Común (SNRC)?',
  contract: createSadaContract(),
  output: sadaOutput,
  fallbackAnswer: 'RESPUESTA MECÁNICA',
})

describe('factualComposer', () => {
  it.each([
    [undefined, false], ['false', false], ['TRUE', false], ['1', false], ['true', true],
  ])('enables only the exact string true: %s', (value, expected) => {
    expect(isFactualComposerEnabled(value)).toBe(expected)
  })

  it('uses a separately configurable model with the current provider fallback', () => {
    expect(factualComposerModel('deepseek-small')).toBe('deepseek-small')
    expect(factualComposerModel('   ')).toBe('deepseek-v4-flash')
  })

  it('builds a minimal DTO only from validated operations and requested parcel scope', () => {
    const evidence = buildFactualComposerEvidence(
      baseOptions().question,
      createSadaContract(),
      sadaOutput
    )
    expect(evidence).toEqual(expect.objectContaining({
      schemaVersion: '1', questionIntent: 'strict_homogeneity', scope: 'parcel',
    }))
    expect(evidence?.validatedFacts.map((fact) => fact.code)).toEqual(['SNRC', 'SNRT'])
    expect(JSON.stringify(evidence)).not.toContain('municipality')
    expect(JSON.stringify(evidence)).not.toContain('normativeReferences')
    expect(JSON.stringify(evidence)).not.toContain('¿Puedo considerar')
  })

  it('composes the complete Sada answer with compact JSON and reasoning disabled', async () => {
    const { client, create } = clientWith(JSON.stringify(sadaPlan))
    const result = await composeValidatedFactualAnswer({ ...baseOptions(), client })

    expect(result.diagnostics).toEqual(expect.objectContaining({
      status: 'composed', fallbackUsed: false, fallbackReason: null,
      inputTokens: 310, outputTokens: 96,
    }))
    expect(result.answer).toMatch(/^No puede considerarse/)
    expect(result.answer).toContain('98,53 %')
    expect(result.answer).toContain('1,47 %')
    expect(result.answer).toContain('categoría predominante')
    expect(result.answer).not.toContain('RESPUESTA MECÁNICA')
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
      max_tokens: 320,
      temperature: 0,
    }), expect.objectContaining({ signal: expect.any(AbortSignal), timeout: 2800 }))
    const request = create.mock.calls[0][0]
    expect(JSON.stringify(request)).not.toContain(baseOptions().question)
  })

  it.each([
    ['invalid JSON', 'not-json', 'invalid_json'],
    ['invalid schema', JSON.stringify({ conclusion: 'free prose' }), 'invalid_schema'],
    ['empty output', '   ', 'render_empty'],
    ['invented category', JSON.stringify({
      ...sadaPlan,
      explanation: [...sadaPlan.explanation, { kind: 'category_share', factId: 'category:parcel:SUR' }],
    }), 'safety_rejected'],
  ])('falls back to the current renderer on %s', async (_case, content, reason) => {
    const result = await composeValidatedFactualAnswer({
      ...baseOptions(), client: clientWith(content).client,
    })
    expect(result.answer).toBe('RESPUESTA MECÁNICA')
    expect(result.diagnostics).toEqual(expect.objectContaining({
      status: 'fallback', fallbackUsed: true, fallbackReason: reason,
    }))
  })

  it('falls back when the provider throws', async () => {
    const create = vi.fn().mockRejectedValue(new Error('provider unavailable'))
    const client = { chat: { completions: { create } } } as unknown as OpenAI
    const result = await composeValidatedFactualAnswer({ ...baseOptions(), client })
    expect(result.answer).toBe('RESPUESTA MECÁNICA')
    expect(result.diagnostics.fallbackReason).toBe('provider_error')
  })

  it('aborts its own small latency budget and falls back', async () => {
    const create = vi.fn((_request, requestOptions: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        requestOptions.signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        }, { once: true })
      })
    )
    const client = { chat: { completions: { create } } } as unknown as OpenAI
    const result = await composeValidatedFactualAnswer({
      ...baseOptions(), client, timeoutMs: 5,
    })
    expect(result.answer).toBe('RESPUESTA MECÁNICA')
    expect(result.diagnostics.fallbackReason).toBe('timeout')
  })

  it('falls back when evidence contains mixed scopes before calling the provider', async () => {
    const { client, create } = clientWith(JSON.stringify(sadaPlan))
    const output = {
      ...sadaOutput,
      operations: [...sadaOutput.operations, {
        operation: 'state_label' as const,
        factRef: { type: 'category' as const, scope: 'actionArea' as const, code: 'SNRC' },
        label: 'Núcleo Rural Común',
      }],
    }
    const result = await composeValidatedFactualAnswer({ ...baseOptions(), output, client })
    expect(result.answer).toBe('RESPUESTA MECÁNICA')
    expect(result.diagnostics.fallbackReason).toBe('evidence_invalid')
    expect(create).not.toHaveBeenCalled()
  })
})
