import { describe, expect, it, vi } from 'vitest'
import type { ReasonerProvider } from '@/application/chat/reasonerProvider'
import { deepSeekResponseFormat } from '@/application/chat/reasonerProvider'
import {
  buildTerritorialSemanticEvidenceInput,
  buildTerritorialSemanticShadowRequest,
  runTerritorialSemanticShadow,
} from './territorialSemanticShadow'
import { buildTerritorialSemanticInputFingerprint, type TerritorialSemanticResolutionV1 } from './territorialSemanticResolution'

function input() {
  return buildTerritorialSemanticEvidenceInput({
    municipalityCode: '15030',
    instrumentId: '27775',
    candidates: [{
      candidateId: 'candidate-penamoa',
      sourceFeatureIds: ['feature-penamoa'],
      literals: {
        homogeneousClassification: 'SUB',
        homogeneousCategory: 'SUB',
        legalClassification: 'SUZ',
        planningCategory: 'Suelo_Urbanizable_Regimen_Transitorio',
        use: 'SURT',
        denomination: 'SURT1',
      },
      coverage: { parcelAreaSquareMetres: 4415.17, intersectionAreaSquareMetres: 4415.17, parcelPercentage: 100, geometryPresent: true },
    }],
    evidencePackets: [{
      packetId: 'packet-penamoa', source: 'siotuga', sourceUrl: 'https://siotuga.xunta.gal/wfs', instrumentId: '27775', candidateIds: ['candidate-penamoa'], sourceFeatureIds: ['feature-penamoa'], kind: 'wfs_attributes',
      text: 'cla_homo=SUB; cat_homo=SUB; cla_ley=SUZ; cat_plan=Suelo_Urbanizable_Regimen_Transitorio; uso=SURT; denom=SURT1',
    }],
    catalogIdentities: [{ identityId: 'identity-1', instrumentId: '27775', officialCode: 'ORD-1', officialName: 'Ordenanza 1', semanticDimension: 'ordinance', catalogStatus: 'ACCEPTED' }],
    existingContradictions: [],
  })
}

function resolution(current = input()): TerritorialSemanticResolutionV1 {
  return {
    schemaVersion: 1,
    inputFingerprint: buildTerritorialSemanticInputFingerprint(current),
    status: 'accepted',
    observations: [{
      candidateId: 'candidate-penamoa', sourceFeatureIds: ['feature-penamoa'],
      literals: { ...current.candidates[0]!.literals },
      operationalClassification: { value: 'model-proposed-class', confidence: 'medium', status: 'accepted' },
      planningArea: { value: 'SURT1', confidence: 'medium', status: 'accepted' },
      evidenceRefs: ['packet-penamoa'], contradictions: [],
    }],
    canonical: { classification: 'model-proposed-class', planningArea: 'SURT1' },
    evidenceRefs: ['packet-penamoa'], contradictions: [],
    provenance: { source: 'official_evidence', provider: 'fake', model: 'fake' },
  }
}

function providerWith(rawContent: string, overrides: Partial<ReasonerProvider> = {}): ReasonerProvider {
  return {
    name: 'fake-shadow',
    generate: vi.fn(async () => ({ provider: 'fake', model: 'fake-model', latencyMs: 12, rawContent })),
    ...overrides,
  }
}

describe('territorialSemanticShadow', () => {
  it('regresión contractual: una request V1 usa json_schema y no sólo json_object', () => {
    const request = buildTerritorialSemanticShadowRequest(input())
    expect(deepSeekResponseFormat(request)).toEqual({
      type: 'json_schema',
      name: 'TerritorialSemanticResolutionV1',
      schema: request.responseSchema,
    })
    expect(deepSeekResponseFormat({ systemPrompt: '', userPrompt: '' })).toEqual({ type: 'json_object' })
    expect(request.responseSchema.required).toContain('abstentionReason')
    expect(request.responseSchema.properties.observations.items.required).toContain('operationalClassification')
  })

  it('acepta los nulls estructurales que exige strict output sin convertirlos en hechos', async () => {
    const strict = JSON.parse(JSON.stringify(resolution(input()))) as Record<string, any>
    strict.canonical = { classification: null, planningArea: null, normativeIdentityId: null }
    strict.abstentionReason = null
    strict.provenance = { source: 'official_evidence', provider: null, model: null, generatedAt: null }
    strict.observations[0].operationalClassification = null
    strict.observations[0].planningArea = null
    strict.observations[0].normativeIdentity = null
    for (const key of Object.keys(strict.observations[0].literals)) strict.observations[0].literals[key] = null
    const result = await runTerritorialSemanticShadow(input(), { provider: providerWith(JSON.stringify(strict)) })
    expect(result.status).toBe('validated')
    expect(result.resolution?.canonical).toEqual({})
  })

  it('construye una request estricta con toda la evidencia literal y sin fallback', () => {
    const request = buildTerritorialSemanticShadowRequest(input(), 1234)
    expect(request.responseSchemaName).toBe('TerritorialSemanticResolutionV1')
    expect(request.responseSchema).toBeDefined()
    expect(request.timeoutMs).toBe(1234)
    expect(request.userPrompt).toContain('cla_homo=SUB')
    expect(request.userPrompt).toContain('cla_ley=SUZ')
    expect(request.userPrompt).toContain('cat_plan=Suelo_Urbanizable_Regimen_Transitorio')
    expect(request.userPrompt).toContain('must never appear in your output')
  })

  it('valida una respuesta del provider y expone métricas sin alterar ningún contexto', async () => {
    const original = input()
    const result = await runTerritorialSemanticShadow(original, { provider: providerWith(JSON.stringify(resolution(original))) })
    expect(result.status).toBe('validated')
    expect(result.resolution?.canonical.classification).toBe('model-proposed-class')
    expect(result.input).toEqual(original)
    expect(result.provider).toBe('fake')
    expect(result.totalTokens).toBeUndefined()
  })

  it('rechaza JSON inválido y provenance inventada', async () => {
    const invalid = providerWith('{not-json')
    expect((await runTerritorialSemanticShadow(input(), { provider: invalid })).status).toBe('validation_failed')

    const forged = resolution()
    forged.evidenceRefs = ['invented-packet']
    const result = await runTerritorialSemanticShadow(input(), { provider: providerWith(JSON.stringify(forged)) })
    expect(result.status).toBe('validation_failed')
    expect(result.errors?.some((error) => error.code === 'unknown_evidence')).toBe(true)
  })

  it('rechaza una identidad inventada o no acreditada por el catálogo', async () => {
    const forged = resolution()
    forged.observations[0]!.normativeIdentity = { identityId: 'invented', identity: 'ORD-X', status: 'accepted' }
    const result = await runTerritorialSemanticShadow(input(), { provider: providerWith(JSON.stringify(forged)) })
    expect(result.status).toBe('validation_failed')
    expect(result.errors?.some((error) => error.code === 'unknown_identity')).toBe(true)
  })

  it('conserva una abstención válida como diagnóstico', async () => {
    const abstained = resolution()
    abstained.status = 'abstained'
    abstained.observations = []
    abstained.canonical = {}
    abstained.abstentionReason = 'Evidencia insuficiente'
    const result = await runTerritorialSemanticShadow(input(), { provider: providerWith(JSON.stringify(abstained)) })
    expect(result.status).toBe('validated')
    expect(result.resolution?.status).toBe('abstained')
  })

  it('acepta conflicto explícito sólo como estado no operativo', async () => {
    const conflict = resolution()
    conflict.status = 'conflict'
    conflict.canonical = {}
    conflict.observations[0]!.contradictions = ['Dos documentos se contradicen']
    conflict.contradictions = ['Dos documentos se contradicen']
    const result = await runTerritorialSemanticShadow(input(), { provider: providerWith(JSON.stringify(conflict)) })
    expect(result.status).toBe('validated')
    expect(result.resolution?.status).toBe('conflict')
  })

  it('mantiene una dimensión acreditada aunque otra sea desconocida', async () => {
    const partial = resolution()
    partial.status = 'review_required'
    partial.observations[0]!.operationalClassification = { value: 'observed-operational-value', confidence: 'high', status: 'accepted' }
    partial.observations[0]!.planningArea = undefined
    partial.canonical = { classification: 'observed-operational-value' }
    const result = await runTerritorialSemanticShadow(input(), { provider: providerWith(JSON.stringify(partial)) })
    expect(result.status).toBe('validated')
  })

  it('no exige identidad normativa para validar una clasificación sustentada', async () => {
    const withoutIdentity = resolution()
    withoutIdentity.observations[0]!.normativeIdentity = undefined
    withoutIdentity.canonical = { classification: 'model-proposed-class' }
    const result = await runTerritorialSemanticShadow(input(), { provider: providerWith(JSON.stringify(withoutIdentity)) })
    expect(result.status).toBe('validated')
  })

  it('permite una contradicción de ámbito sin contaminar la clasificación aceptada', async () => {
    const scoped = resolution()
    scoped.status = 'review_required'
    scoped.observations[0]!.operationalClassification = { value: 'model-proposed-class', confidence: 'high', status: 'accepted' }
    scoped.observations[0]!.planningArea = { value: 'uncertain-area', confidence: 'low', status: 'review_required' }
    scoped.observations[0]!.contradictions = ['Ámbito: evidencia documental insuficiente']
    scoped.canonical = { classification: 'model-proposed-class' }
    const result = await runTerritorialSemanticShadow(input(), { provider: providerWith(JSON.stringify(scoped)) })
    expect(result.status).toBe('validated')
  })

  it('rechaza canonical incompatible con unknown global o con valores de estado', async () => {
    const incoherent = resolution()
    incoherent.status = 'unknown'
    incoherent.canonical = { classification: 'model-proposed-class' }
    expect((await runTerritorialSemanticShadow(input(), { provider: providerWith(JSON.stringify(incoherent)) })).status).toBe('validation_failed')

    const statusAsValue = resolution()
    statusAsValue.observations[0]!.operationalClassification = { value: 'review_required', confidence: 'low', status: 'review_required' }
    expect((await runTerritorialSemanticShadow(input(), { provider: providerWith(JSON.stringify(statusAsValue)) })).status).toBe('validation_failed')
  })

  it('devuelve llm_failed en timeout o error y no usa otro provider', async () => {
    const provider = providerWith('', { generate: vi.fn(async () => { throw new Error('timeout') }) })
    const result = await runTerritorialSemanticShadow(input(), { provider })
    expect(result.status).toBe('llm_failed')
    expect(result.error).toBe('timeout')
    expect(provider.generate).toHaveBeenCalledTimes(1)
  })

  it('no permite mutación de cobertura en la respuesta shadow', async () => {
    const forged = resolution()
    ;(forged as TerritorialSemanticResolutionV1 & { coverage?: unknown }).coverage = { parcelPercentage: 100 }
    const result = await runTerritorialSemanticShadow(input(), { provider: providerWith(JSON.stringify(forged)) })
    expect(result.status).toBe('validation_failed')
    expect(result.errors?.some((error) => error.code === 'coverage_mutation')).toBe(true)
  })
})
