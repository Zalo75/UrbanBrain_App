import { describe, it, expect, vi } from 'vitest'
import { runTerritorialFactualShadowPipeline } from './shadowPipeline'
import type { TerritorialFactualContract } from '@/domain/parcel-context/factualContract'
import type { NormalizedParcelContext } from '@/domain/parcel-context/types'
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
            choices: [{ message: { content: mockResponse } }],
            usage: { prompt_tokens: 456, completion_tokens: 32 },
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
    expect(result.diagnostics.phases).toEqual(expect.objectContaining({
      contractMs: expect.any(Number),
      payloadMs: expect.any(Number),
      providerMs: expect.any(Number),
      parseMs: expect.any(Number),
      validateMs: expect.any(Number),
      renderMs: expect.any(Number),
    }))
    expect(result.diagnostics.metrics).toEqual(expect.objectContaining({
      payloadChars: expect.any(Number),
      inputTokens: 456,
      outputTokens: 32,
      factCount: 5,
      candidateCount: 0,
      operationCount: 1,
      abstentionCount: 0,
      coverageComplete: true,
    }))
  })

  it('A2. completa determinísticamente la cobertura Sada antes del renderer', async () => {
    const llmOutput = {
      operations: [
        {
          operation: 'state_percentage',
          factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
          percentage: 98.53,
        },
        {
          operation: 'state_geometric_dominance',
          factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
        },
      ],
      abstentions: [],
    }

    const result = await runTerritorialFactualShadowPipeline(
      '¿Puedo considerar toda la parcela como SNRC?',
      createMockContract(),
      mockClient(JSON.stringify(llmOutput))
    )

    expect(result.status).toBe('valid')
    expect(result.structuredOutput?.operations).toContainEqual({
      operation: 'state_percentage',
      factRef: { type: 'category', scope: 'parcel', code: 'SNRT' },
      percentage: 1.47,
    })
    expect(result.structuredOutput?.operations).toContainEqual({
      operation: 'state_conflict',
      factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
    })
    expect(result.structuredOutput?.operations).toContainEqual({
      operation: 'state_determination',
      factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
      determination: 'unresolved',
    })
    expect(result.renderedText?.join(' ')).toContain('1,47 %')
    expect(result.renderedText?.join(' ')).not.toContain('100 %')
    expect(result.diagnostics.metrics).toEqual(expect.objectContaining({
      operationCount: 2,
      coverageRequiredCount: 4,
      coverageSelectedCount: 1,
      coverageAddedCount: 3,
      coverageComplete: true,
      coverageReason: 'completed_deterministically',
    }))
  })

  it('A3. mantiene visible categories parcel aunque classification auxiliar sea irrepresentable', async () => {
    const contract = createMockContract()
    contract.factsByScope!.parcel!.classification = {
      semanticCompleteness: 'partial',
      status: 'unresolved',
      determination: 'unresolved',
    }
    contract.classification = contract.factsByScope!.parcel!.classification
    const llmOutput = {
      operations: [{
        operation: 'state_percentage',
        factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
        percentage: 98.53,
      }],
      abstentions: [],
    }

    const result = await runTerritorialFactualShadowPipeline(
      '¿Qué categorías existen en toda la parcela?',
      contract,
      mockClient(JSON.stringify(llmOutput))
    )

    expect(result.status).toBe('valid')
    expect(result.diagnostics.metrics).toEqual(expect.objectContaining({
      coverageComplete: true,
      coverageReason: 'completed_deterministically',
    }))
    expect(result.structuredOutput?.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation: 'state_percentage', percentage: 98.53,
        factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
      }),
      expect.objectContaining({
        operation: 'state_percentage', percentage: 1.47,
        factRef: { type: 'category', scope: 'parcel', code: 'SNRT' },
      }),
      expect.objectContaining({
        operation: 'state_conflict',
        factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
      }),
    ]))
    expect(result.structuredOutput?.operations.some((operation) =>
      operation.factRef.type === 'classification'
    )).toBe(false)
    expect(result.renderedText?.join(' ')).toContain('98,53 %')
    expect(result.renderedText?.join(' ')).toContain('1,47 %')
  })

  it('A4. coverage full acreditada responde totalidad y 100 sin state_percentage inventado', async () => {
    const contract = createMockContract()
    contract.factsByScope!.parcel!.categories = [{
      code: 'SNRSC', label: 'SNRSC', semanticCompleteness: 'complete',
      status: 'automatic_confirmed', determination: 'automatic', coverage: 'full',
    }]
    contract.categories = contract.factsByScope!.parcel!.categories
    const result = await runTerritorialFactualShadowPipeline(
      '¿Toda la parcela tiene la misma categoría urbanística?',
      contract,
      mockClient(JSON.stringify({ operations: [], abstentions: [] }))
    )

    expect(result.status).toBe('valid')
    expect(result.structuredOutput?.operations).toContainEqual({
      operation: 'state_coverage', coverage: 'full',
      factRef: { type: 'category', scope: 'parcel', code: 'SNRSC' },
    })
    expect(result.structuredOutput?.operations.some((operation) =>
      operation.operation === 'state_percentage'
    )).toBe(false)
    expect(result.renderedText?.join(' ')).toContain('100 %')
    expect(result.renderedText?.join(' ')).not.toMatch(/coverage|scope|automatic_confirmed/i)
    expect(result.diagnostics.metrics?.territorialCoverageByCategory).toEqual({
      'parcel:SNRSC': 'full',
    })
  })

  it('A5. publishes safe derivation diagnostics without changing the factual result', async () => {
    const geometry = {
      type: 'MultiPolygon' as const,
      coordinates: [[[[-8.1, 43.6], [-8.09, 43.6], [-8.1, 43.61], [-8.1, 43.6]]]],
      crs: 'EPSG:4326' as const,
    }
    const facts = {
      classification: {
        value: { code: 'SNR' }, status: 'automatic_confirmed' as const,
        origin: 'spatial_intersection' as const, confidence: 'high' as const,
        evidence: [], warnings: [], discrepancies: [], nextAction: 'none' as const,
      },
      category: {
        value: { code: 'SNRSC' }, status: 'automatic_confirmed' as const,
        origin: 'spatial_intersection' as const, confidence: 'high' as const,
        evidence: [], warnings: [], discrepancies: [], nextAction: 'none' as const,
      },
      consolidation: {
        status: 'not_available' as const, confidence: 'unknown' as const,
        evidence: [], warnings: [], discrepancies: [], nextAction: 'none' as const,
      },
    }
    const context: NormalizedParcelContext = {
      parcelGeometry: geometry, parcelSurfaceSquareMetres: 854.78,
      parcelUrbanisticFacts: facts, urbanisticFacts: facts,
      actionArea: {
        value: {
          id: 'whole', geometry, surfaceSquareMetres: 854.78,
          parcelSurfaceSquareMetres: 854.78, selectionType: 'whole_parcel',
          source: 'catastro', confidence: 'high', selectedBy: 'system',
          selectedAt: '2026-08-15T08:00:00.000Z', verification: 'unverified',
        },
        source: 'urbanbrain', confidence: 1, verification: 'confirmed',
      },
      knownConstraints: [], parcelKnownConstraints: [], conflicts: [], pendingValidation: [],
    }
    const result = await runTerritorialFactualShadowPipeline(
      '¿Toda la parcela tiene la misma categoría urbanística?',
      context,
      mockClient(JSON.stringify({ operations: [], abstentions: [] }))
    )

    expect(result.status).toBe('valid')
    expect(result.renderedText?.join(' ')).toContain('100 %')
    expect(result.diagnostics.metrics?.territorialCoverageDiagnostics?.['parcel:SNRSC'])
      .toEqual(expect.objectContaining({ result: 'full', failedRequirements: [] }))
    expect(JSON.stringify(result.diagnostics)).not.toMatch(
      /15088A034002230000HU|coordinates|GeoJSON|¿Toda la parcela/
    )
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
    // El estado conflict acreditado permite llegar al renderer y comprobar su fail-safe.
    contract.factsByScope!.parcel!.categories!.push({ code: 'CRASH', status: 'conflict', determination: 'automatic' } as any)
    const client = mockClient(JSON.stringify(output))

    const result = await runTerritorialFactualShadowPipeline('?', contract, client)

    expect(result.status).toBe('render_failed')
    expect(result.diagnostics.error).toContain('Render fail-safe triggered')
  })

  it('I. state_conflict sin status conflict falla en validación', async () => {
    const output = {
      operations: [
        { operation: 'state_conflict', factRef: { type: 'classification', scope: 'parcel' } }
      ],
      abstentions: []
    }
    const client = mockClient(JSON.stringify(output))
    const result = await runTerritorialFactualShadowPipeline('?', createMockContract(), client)

    expect(result.status).toBe('validation_failed')
    expect(result.validation?.errors[0].code).toBe('STATUS_MISMATCH')
  })

  it('J. state_unresolved sin status unresolved falla en validación', async () => {
    const output = {
      operations: [
        { operation: 'state_unresolved', factRef: { type: 'category', scope: 'parcel', code: 'SNRC' } }
      ],
      abstentions: []
    }
    const client = mockClient(JSON.stringify(output))
    const result = await runTerritorialFactualShadowPipeline('?', createMockContract(), client)

    expect(result.status).toBe('validation_failed')
    expect(result.validation?.errors[0].code).toBe('STATUS_MISMATCH')
    expect(result.diagnostics.metrics).toEqual(expect.objectContaining({
      validationErrorCount: 1,
      validationErrorCodes: ['STATUS_MISMATCH'],
      validationErrorOperations: [{
        operation: 'state_unresolved',
        factRef: { type: 'category', scope: 'parcel', code: 'SNRC' },
      }],
    }))
    expect(result.diagnostics.metrics).not.toHaveProperty('question')
    expect(result.diagnostics.metrics).not.toHaveProperty('payload')
    expect(result.diagnostics.metrics).not.toHaveProperty('rawLlmResponse')
  })

  it('K. diagnostics omite codes no seguros de factRefs inválidos', async () => {
    const output = {
      operations: [{
        operation: 'state_conflict',
        factRef: {
          type: 'category',
          scope: 'parcel',
          code: 'PRIVATE USER TEXT WITH SPACES',
        },
      }],
      abstentions: [],
    }
    const result = await runTerritorialFactualShadowPipeline(
      'pregunta privada',
      createMockContract(),
      mockClient(JSON.stringify(output))
    )

    expect(result.status).toBe('validation_failed')
    expect(result.diagnostics.metrics?.validationErrorCodes).toEqual(['INVALID_FACT_REF'])
    expect(result.diagnostics.metrics?.validationErrorOperations).toEqual([{
      operation: 'state_conflict',
      factRef: { type: 'category', scope: 'parcel' },
    }])
    expect(JSON.stringify(result.diagnostics.metrics)).not.toContain('PRIVATE USER TEXT')
    expect(JSON.stringify(result.diagnostics.metrics)).not.toContain('pregunta privada')
  })
})
