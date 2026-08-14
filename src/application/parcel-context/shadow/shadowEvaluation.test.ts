import { describe, it, expect, vi } from 'vitest'
import { runTerritorialFactualShadowEvaluation } from './shadowEvaluator'
import { SHADOW_FACTUAL_SYSTEM_PROMPT } from './shadowSystemPrompt'
import type { TerritorialFactualContract } from '@/domain/parcel-context/factualContract'
import type OpenAI from 'openai'

describe('shadowEvaluator', () => {
  it('category query exige seleccionar classification y category del mismo scope', () => {
    expect(SHADOW_FACTUAL_SYSTEM_PROMPT).toContain('Ante preguntas sobre categoría o ámbito urbanístico')
    expect(SHADOW_FACTUAL_SYSTEM_PROMPT).toContain('incluye operaciones de identidad para classification Y para cada category pertinente')
    expect(SHADOW_FACTUAL_SYSTEM_PROMPT).toContain('dentro de ESE MISMO scope')
    expect(SHADOW_FACTUAL_SYSTEM_PROMPT).toContain('No omitas classification por preguntar por category')
    expect(SHADOW_FACTUAL_SYSTEM_PROMPT).toContain('ni cruces classification o category desde otro scope')
  })

  it('envia el contrato serializado al modelo y retorna la respuesta', async () => {
    const onDiagnostics = vi.fn()
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: 'Respuesta simulada' } }],
            usage: { prompt_tokens: 321, completion_tokens: 24 },
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

    expect(response).toBe('Respuesta simulada')
    expect(mockClient.chat.completions.create).toHaveBeenCalled()
    const callArgs = (mockClient.chat.completions.create as any).mock.calls[0][0]
    expect(callArgs.messages[0].content).toContain('SNR') // Verifica que el contrato se inyectó
    expect(callArgs.messages[0].content).toContain('incluye operaciones de identidad para classification Y para cada category pertinente')
    expect(callArgs.messages[0].content).toContain('dentro de ESE MISMO scope')
    expect(callArgs.messages[0].content).toContain('No omitas classification por preguntar por category')
    expect(onDiagnostics).toHaveBeenCalledWith(expect.objectContaining({
      payloadMs: expect.any(Number),
      providerStartedAt: expect.any(Number),
      providerFinishedAt: expect.any(Number),
      providerMs: expect.any(Number),
      payloadChars: expect.any(Number),
      inputTokens: 321,
      outputTokens: 24,
    }))
  })
})
