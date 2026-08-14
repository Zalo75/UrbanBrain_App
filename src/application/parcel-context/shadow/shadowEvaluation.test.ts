import { describe, it, expect, vi } from 'vitest'
import { runTerritorialFactualShadowEvaluation } from './shadowEvaluator'
import { SHADOW_FACTUAL_SYSTEM_PROMPT } from './shadowSystemPrompt'
import type { TerritorialFactualContract } from '@/domain/parcel-context/factualContract'
import type OpenAI from 'openai'

describe('shadowEvaluator', () => {
  it('category query exige category y mantiene classification como apoyo representable del mismo scope', () => {
    expect(SHADOW_FACTUAL_SYSTEM_PROMPT).toContain('Ante preguntas sobre categoría o ámbito urbanístico')
    expect(SHADOW_FACTUAL_SYSTEM_PROMPT).toContain('incluye cada category pertinente dentro del scope solicitado')
    expect(SHADOW_FACTUAL_SYSTEM_PROMPT).toContain('classification del MISMO scope solo cuando tenga label completo o code representable')
    expect(SHADOW_FACTUAL_SYSTEM_PROMPT).toContain('su ausencia de representación NO debe causar abstention')
    expect(SHADOW_FACTUAL_SYSTEM_PROMPT).toContain('No cruces classification o category desde otro scope')
  })

  it('distingue status unresolved de determination unresolved y exige JSON compacto', () => {
    expect(SHADOW_FACTUAL_SYSTEM_PROMPT).toContain("state_unresolved SOLO cuando fact.status sea exactamente 'unresolved'")
    expect(SHADOW_FACTUAL_SYSTEM_PROMPT).toContain("fact.status es 'conflict' y fact.determination es 'unresolved'")
    expect(SHADOW_FACTUAL_SYSTEM_PROMPT).toContain("state_determination con 'unresolved'")
    expect(SHADOW_FACTUAL_SYSTEM_PROMPT).toContain('No muestres razonamiento')
    expect(SHADOW_FACTUAL_SYSTEM_PROMPT).toContain('Emite como máximo una operación')
  })

  it('envia el contrato serializado al modelo y retorna la respuesta', async () => {
    const onDiagnostics = vi.fn()
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: '{"operations":[],"abstentions":[]}' } }],
            usage: {
              prompt_tokens: 321,
              completion_tokens: 24,
              completion_tokens_details: { reasoning_tokens: 0 },
            },
          })
        }
      }
    } as unknown as OpenAI

    const contract: TerritorialFactualContract = {
      identity: {},
      scopes: {},
      classification: { code: 'SNR', status: 'automatic_confirmed', determination: 'automatic' },
      categories: [{ code: 'SNRC', parcelPercentage: 98.53, status: 'conflict', determination: 'unresolved' }],
      consolidation: { status: 'unresolved', determination: 'unresolved' },
      planningAreas: [],
      affects: { status: 'unresolved', items: [] },
      normativeReferences: {}
    }

    const response = await runTerritorialFactualShadowEvaluation(
      '¿Cual es la clasificacion?',
      contract,
      { client: mockClient, onDiagnostics }
    )

    expect(response).toBe('{"operations":[],"abstentions":[]}')
    expect(mockClient.chat.completions.create).toHaveBeenCalled()
    const callArgs = (mockClient.chat.completions.create as any).mock.calls[0][0]
    expect(callArgs.messages[0].content).toContain('SNR') // Verifica que el contrato se inyectó
    expect(callArgs.messages[0].content).toContain('incluye cada category pertinente dentro del scope solicitado')
    expect(callArgs.messages[0].content).toContain('classification del MISMO scope solo cuando tenga label completo o code representable')
    expect(callArgs.messages[0].content).toContain('su ausencia de representación NO debe causar abstention')
    expect(callArgs.response_format).toEqual({ type: 'json_object' })
    expect(callArgs.thinking).toEqual({ type: 'disabled' })
    expect(callArgs.max_tokens).toBeUndefined()
    expect(onDiagnostics).toHaveBeenCalledWith(expect.objectContaining({
      payloadMs: expect.any(Number),
      providerStartedAt: expect.any(Number),
      providerFinishedAt: expect.any(Number),
      providerMs: expect.any(Number),
      payloadChars: expect.any(Number),
      inputTokens: 321,
      outputTokens: 24,
      reasoningTokens: 0,
    }))
  })
})
