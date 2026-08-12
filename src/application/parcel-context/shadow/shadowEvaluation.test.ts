import { describe, it, expect, vi } from 'vitest'
import { runTerritorialFactualShadowEvaluation } from './shadowEvaluator'
import type { TerritorialFactualContract } from '@/domain/parcel-context/factualContract'
import type OpenAI from 'openai'

describe('shadowEvaluator', () => {
  it('envia el contrato serializado al modelo y retorna la respuesta', async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: 'Respuesta simulada' } }]
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

    const response = await runTerritorialFactualShadowEvaluation('¿Cual es la clasificacion?', contract, { client: mockClient })

    expect(response).toBe('Respuesta simulada')
    expect(mockClient.chat.completions.create).toHaveBeenCalled()
    const callArgs = (mockClient.chat.completions.create as any).mock.calls[0][0]
    expect(callArgs.messages[0].content).toContain('SNR') // Verifica que el contrato se inyectó
  })
})
