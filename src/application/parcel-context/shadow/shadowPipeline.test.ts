import { describe, it, expect, vi } from 'vitest'
import { runTerritorialFactualShadowPipeline } from './shadowPipeline'
import type { TerritorialFactualContract } from '@/domain/parcel-context/factualContract'
import type OpenAI from 'openai'

vi.mock('./factualRenderer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./factualRenderer')>()
  return {
    ...actual,
    renderFactualOutput: (output: any, contract: any) => {
      if (output.operations[0]?.operation === 'state_conflict' && output.operations[0]?.factRef?.code === 'CRASH') {
        throw new Error('Mock renderer crash')
      }
      return actual.renderFactualOutput(output, contract)
    }
  }
})

describe('Territorial Factual Shadow Pipeline', () => {
  const mockClient = (mockResponse: string) => {
    return {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: mockResponse } }]
          })
        }
      }
    } as unknown as OpenAI
  }

  const createMockContract = (): TerritorialFactualContract => {
    const contract = {
      identity: { municipalityName: 'Sada' },
      scopes: {},
      classification: { code: 'SNR', semanticCompleteness: 'complete', label: 'Suelo de núcleo rural', status: 'automatic_confirmed', determination: 'automatic', confidence: 'high', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' },
      categories: [
        { code: 'SNRC', label: 'Núcleo rural común', semanticCompleteness: 'complete', parcelPercentage: 98.53, status: 'conflict', determination: 'unresolved' },
        { code: 'SNRT', label: 'Núcleo rural tradicional', semanticCompleteness: 'complete', parcelPercentage: 1.47, status: 'conflict', determination: 'unresolved' }
      ],
      consolidation: { status: 'unresolved', determination: 'unresolved', confidence: 'unknown', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' },
      planningAreas: [],
      affects: { status: 'checked', items: [], confidence: 'unknown', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' },
      normativeReferences: {}
    } as unknown as TerritorialFactualContract

    contract.factsByScope = {
      parcel: {
        classification: contract.classification,
        categories: contract.categories,
        consolidation: contract.consolidation,
        planningAreas: contract.planningAreas,
        affects: contract.affects
      }
    }
    return contract
  }

  it('A. StructuredOutput válido', async () => {
    const contract = createMockContract()
    const validOutput = {
      operations: [
        { operation: 'state_percentage', factRef: { type: 'category', scope: 'parcel', code: 'SNRC' }, percentage: 98.53 }
      ],
      abstentions: []
    }
    const client = mockClient(JSON.stringify(validOutput))
    const result = await runTerritorialFactualShadowPipeline('¿Cuál predomina?', contract, client)

    expect(result.status).toBe('valid')
    expect(result.renderedText?.[0]).toContain('representa el 98,53 %')
  })

  it('B. Output inválido (JSON malformado)', async () => {
    const client = mockClient('Esto no es un json')
    const result = await runTerritorialFactualShadowPipeline('?', createMockContract(), client)

    expect(result.status).toBe('llm_failed')
    expect(result.diagnostics.error).toContain('JSON Parse error')
  })

  it('C. Output con hallucinated label', async () => {
    const contract = createMockContract()
    contract.categories[0].semanticCompleteness = 'partial'
    const output = {
      operations: [
        { operation: 'state_label', factRef: { type: 'category', scope: 'parcel', code: 'SNRC' }, label: 'Inventado' }
      ],
      abstentions: []
    }
    const client = mockClient(JSON.stringify(output))
    const result = await runTerritorialFactualShadowPipeline('?', contract, client)

    expect(result.status).toBe('validation_failed')
    expect(result.validation?.errors[0].code).toBe('LABEL_HALLUCINATION')
  })

  it('D. Output con percentage mismatch', async () => {
    const output = {
      operations: [
        { operation: 'state_percentage', factRef: { type: 'category', scope: 'parcel', code: 'SNRC' }, percentage: 50.00 }
      ],
      abstentions: []
    }
    const client = mockClient(JSON.stringify(output))
    const result = await runTerritorialFactualShadowPipeline('?', createMockContract(), client)

    expect(result.status).toBe('validation_failed')
    expect(result.validation?.errors[0].code).toBe('PERCENTAGE_MISMATCH')
  })

  it('E. Output con scope mismatch', async () => {
    const contract = createMockContract()
    const output = {
      operations: [
        { operation: 'state_status', factRef: { type: 'classification', scope: 'actionArea' }, status: 'automatic_confirmed' }
      ],
      abstentions: []
    }
    const client = mockClient(JSON.stringify(output))
    const result = await runTerritorialFactualShadowPipeline('?', contract, client)

    expect(result.status).toBe('validation_failed')
    expect(result.validation?.errors[0].code).toBe('INVALID_FACT_REF')
  })

  it('F. Output conflict -> effective (renderer fail-safe, or validation?)', async () => {
    const output = {
      operations: [
        { operation: 'state_status', factRef: { type: 'category', scope: 'parcel', code: 'SNRC' }, status: 'effective' }
      ],
      abstentions: []
    }
    const contract = createMockContract()
    const client = mockClient(JSON.stringify(output))
    const result = await runTerritorialFactualShadowPipeline('?', contract, client)

    // Status is 'conflict' in contract, but output says 'effective'.
    // Validation catches this as STATUS_MISMATCH.
    expect(result.status).toBe('validation_failed')
    expect(result.validation?.errors[0].code).toBe('STATUS_MISMATCH')
  })

  it('G. Output unresolved -> absence', async () => {
    const output = {
      operations: [
        { operation: 'state_absence', factRef: { type: 'consolidation', scope: 'parcel' } }
      ],
      abstentions: []
    }
    const contract = createMockContract()
    const client = mockClient(JSON.stringify(output))
    const result = await runTerritorialFactualShadowPipeline('?', contract, client)

    expect(result.status).toBe('validation_failed')
    expect(result.validation?.errors[0].code).toBe('UNRESOLVED_AS_ABSENCE')
  })

  it('H. Renderer throw (fail-safe fallback)', async () => {
    const output = {
      operations: [
        { operation: 'state_conflict', factRef: { type: 'category', scope: 'parcel', code: 'CRASH' } }
      ],
      abstentions: []
    }
    const contract = createMockContract()
    // Añadimos el category para que pase validación (ya que state_conflict no comprueba status)
    contract.factsByScope!.parcel!.categories!.push({ code: 'CRASH', status: 'conflict', determination: 'automatic' } as any)
    const client = mockClient(JSON.stringify(output))

    const result = await runTerritorialFactualShadowPipeline('?', contract, client)

    expect(result.status).toBe('render_failed')
    expect(result.diagnostics.error).toContain('Render fail-safe triggered')
  })
})
