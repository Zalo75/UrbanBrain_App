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

  it('composes actionArea classification manual state once instead of exposing mechanical duplicates', async () => {
    const contract = createSadaContract()
    const classification = {
      code: 'SNR', label: 'Suelo de Núcleo Rural', semanticCompleteness: 'complete' as const,
      status: 'manual_review_required' as const, determination: 'manual' as const,
    }
    contract.scopes.actionArea = { hasGeometry: true }
    contract.factsByScope!.actionArea = { classification }
    const output = {
      operations: [
        { operation: 'state_label' as const, factRef: { type: 'classification' as const, scope: 'actionArea' as const }, label: 'Suelo de Núcleo Rural' },
        { operation: 'state_status' as const, factRef: { type: 'classification' as const, scope: 'actionArea' as const }, status: 'manual_review_required' },
        { operation: 'state_determination' as const, factRef: { type: 'classification' as const, scope: 'actionArea' as const }, determination: 'manual' },
      ],
      abstentions: [],
    }
    const plan = {
      schemaVersion: '1',
      conclusion: { kind: 'classification_identity' },
      explanation: [{ kind: 'fact_identity', factId: 'classification:actionArea' }],
      caveats: [
        { kind: 'manual_review_required', factId: 'classification:actionArea' },
        { kind: 'manual_determination', factId: 'classification:actionArea' },
      ],
      recommendedChecks: ['confirm_pending_determination'],
    }
    const { client } = clientWith(JSON.stringify(plan))

    const result = await composeValidatedFactualAnswer({
      question: '¿Qué clasificación tiene el área seleccionada?',
      contract, output, fallbackAnswer: 'RESPUESTA MECÁNICA DUPLICADA', client,
    })

    expect(result.diagnostics.status).toBe('composed')
    expect(result.answer).toContain('clasificación Suelo de Núcleo Rural (SNR)')
    expect(result.answer.match(/revisión manual/g)).toHaveLength(1)
    expect(result.answer).not.toContain('RESPUESTA MECÁNICA')
    expect(result.answer).not.toContain('Conviene confirmar')
  })

  it('composes actionArea category with its representable classification and manual state', async () => {
    const contract = createSadaContract()
    const classification = {
      code: 'SNR', label: 'Suelo de Núcleo Rural', semanticCompleteness: 'complete' as const,
      status: 'automatic_confirmed' as const, determination: 'automatic' as const,
    }
    const category = {
      code: 'SNRC', label: 'Núcleo Rural Común', semanticCompleteness: 'complete' as const,
      status: 'manual_review_required' as const, determination: 'manual' as const,
    }
    contract.scopes.actionArea = { hasGeometry: true }
    contract.factsByScope!.actionArea = { classification, categories: [category] }
    const output = {
      operations: [
        { operation: 'state_label' as const, factRef: { type: 'classification' as const, scope: 'actionArea' as const }, label: classification.label },
        { operation: 'state_label' as const, factRef: { type: 'category' as const, scope: 'actionArea' as const, code: 'SNRC' }, label: category.label },
        { operation: 'state_status' as const, factRef: { type: 'category' as const, scope: 'actionArea' as const, code: 'SNRC' }, status: 'manual_review_required' },
        { operation: 'state_determination' as const, factRef: { type: 'category' as const, scope: 'actionArea' as const, code: 'SNRC' }, determination: 'manual' },
      ],
      abstentions: [],
    }
    const plan = {
      schemaVersion: '1',
      conclusion: { kind: 'category_identity' },
      explanation: [
        { kind: 'fact_identity', factId: 'classification:actionArea' },
        { kind: 'fact_identity', factId: 'category:actionArea:SNRC' },
      ],
      caveats: [
        { kind: 'manual_review_required', factId: 'category:actionArea:SNRC' },
        { kind: 'manual_determination', factId: 'category:actionArea:SNRC' },
      ],
    }
    const result = await composeValidatedFactualAnswer({
      question: 'Que categoria tiene exactamente el area seleccionada?',
      contract, output, fallbackAnswer: 'RESPUESTA MECÁNICA',
      client: clientWith(JSON.stringify(plan)).client,
    })

    expect(result.diagnostics).toEqual(expect.objectContaining({ status: 'composed', fallbackUsed: false }))
    expect(result.answer).toContain('Suelo de Núcleo Rural (SNR)')
    expect(result.answer).toContain('Núcleo Rural Común (SNRC)')
    expect(result.answer.match(/manual/g)).toHaveLength(1)
    expect(result.answer).not.toContain('SNRT')
  })

  it('reports exact safe schema diagnostics without retaining model prose', async () => {
    const content = JSON.stringify({
      schemaVersion: '1', conclusion: { kind: 'invented_conclusion' },
      explanation: 'private model prose', extra: 'private question text',
    })
    const result = await composeValidatedFactualAnswer({
      ...baseOptions(), client: clientWith(content).client,
    })

    expect(result.diagnostics).toEqual(expect.objectContaining({
      fallbackReason: 'invalid_schema',
      schemaErrorCount: 3,
      schemaErrorCodes: expect.arrayContaining(['additional_property', 'invalid_enum', 'invalid_type']),
      schemaErrorPaths: expect.arrayContaining(['$.extra', '$.conclusion.kind', '$.explanation']),
      schemaErrorValueTypes: expect.arrayContaining(['$.conclusion.kind:string', '$.explanation:string']),
      schemaInvalidEnums: ['invented_conclusion'],
    }))
    expect(JSON.stringify(result.diagnostics)).not.toContain('private')
  })

  it('reports the exact safety rejection code without exposing evidence', async () => {
    const plan = {
      ...sadaPlan,
      explanation: sadaPlan.explanation.filter((item) => item.factId !== 'category:parcel:SNRT'),
    }
    const result = await composeValidatedFactualAnswer({
      ...baseOptions(), client: clientWith(JSON.stringify(plan)).client,
    })

    expect(result.diagnostics).toEqual(expect.objectContaining({
      fallbackReason: 'safety_rejected',
      safetyErrorCodes: ['missing_material_category'],
    }))
    expect(JSON.stringify(result.diagnostics)).not.toContain('SNRT')
    expect(JSON.stringify(result.diagnostics)).not.toContain(baseOptions().question)
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
