import { describe, expect, it } from 'vitest'
import {
  buildTerritorialSemanticInputFingerprint,
  parseAndValidateTerritorialSemanticResolution,
  validateTerritorialSemanticResolution,
  type TerritorialSemanticEvidenceInput,
  type TerritorialSemanticResolutionV1,
} from './territorialSemanticResolution'

function penamoaInput(): TerritorialSemanticEvidenceInput {
  return {
    municipalityCode: '15030',
    instrumentId: '27775',
    candidates: [
      {
        candidateId: 'siotuga:SUB|SUB',
        instrumentId: '27775',
        sourceFeatureIds: ['27775:feature:1'],
        literals: {
          homogeneousClassification: 'SUB',
          homogeneousCategory: 'SUB',
          legalClassification: 'SUZ',
          planningCategory: 'Suelo_Urbanizable_Regimen_Transitorio',
          use: 'SURT',
          denomination: 'SURT1',
        },
        coverage: {
          parcelAreaSquareMetres: 4415.17256,
          intersectionAreaSquareMetres: 4415.17256,
          parcelPercentage: 100,
          geometryPresent: true,
        },
      },
    ],
    evidencePackets: [
      {
        packetId: 'wfs:27775:feature:1',
        source: 'siotuga',
        sourceUrl: 'https://siotuga.xunta.gal/siotuga/ws',
        instrumentId: '27775',
        candidateIds: ['siotuga:SUB|SUB'],
        sourceFeatureIds: ['27775:feature:1'],
        kind: 'wfs_attributes',
        text: 'cla_homo=SUB; cat_homo=SUB; cla_ley=SUZ; cat_plan=Suelo_Urbanizable_Regimen_Transitorio; uso=SURT; denom=SURT1',
      },
      {
        packetId: 'legend:27775:3clas',
        source: 'siotuga',
        sourceUrl: 'https://siotuga.xunta.gal/siotuga/ws?REQUEST=GetLegendGraphic',
        instrumentId: '27775',
        candidateIds: ['siotuga:SUB|SUB'],
        sourceFeatureIds: ['27775:feature:1'],
        kind: 'legend',
        text: 'Leyenda oficial de la capa de clasificación.',
      },
    ],
    catalogIdentities: [
      {
        identityId: '27775:ordinance:accepted',
        instrumentId: '27775',
        officialCode: 'ORD-1',
        officialName: 'Identidad oficial 1',
        semanticDimension: 'ordinance',
        catalogStatus: 'ACCEPTED',
      },
      {
        identityId: '27775:ordinance:review',
        instrumentId: '27775',
        officialCode: 'ORD-REVIEW',
        officialName: 'Identidad pendiente',
        semanticDimension: 'ordinance',
        catalogStatus: 'REVIEW_REQUIRED',
      },
    ],
    existingContradictions: [],
  }
}

function validResolution(input = penamoaInput()): TerritorialSemanticResolutionV1 {
  return {
    schemaVersion: 1,
    inputFingerprint: buildTerritorialSemanticInputFingerprint(input),
    status: 'accepted',
    observations: [{
      candidateId: 'siotuga:SUB|SUB',
      sourceFeatureIds: ['27775:feature:1'],
      literals: { ...input.candidates[0]!.literals },
      // Deliberately opaque: the validator checks provenance, not a hard-coded
      // urbanistic equivalence.
      operationalClassification: { value: 'normalized-semantic-value', confidence: 'high', status: 'accepted' },
      planningArea: { value: 'SURT1', confidence: 'high', status: 'accepted' },
      evidenceRefs: ['wfs:27775:feature:1', 'legend:27775:3clas'],
      contradictions: [],
    }],
    canonical: { classification: 'normalized-semantic-value', planningArea: 'SURT1' },
    evidenceRefs: ['wfs:27775:feature:1', 'legend:27775:3clas'],
    contradictions: [],
    provenance: { source: 'official_evidence', provider: 'test', model: 'test-model' },
  }
}

describe('TerritorialSemanticResolutionV1', () => {
  it('acepta evidencia oficial literal sin codificar una equivalencia urbanística', () => {
    const input = penamoaInput()
    const result = validateTerritorialSemanticResolution(validResolution(input), input)
    expect(result).toMatchObject({ valid: true, errors: [] })
  })

  it('genera un fingerprint estable para el mismo input', () => {
    const input = penamoaInput()
    expect(buildTerritorialSemanticInputFingerprint(input)).toBe(buildTerritorialSemanticInputFingerprint(structuredClone(input)))
    expect(buildTerritorialSemanticInputFingerprint(input)).toMatch(/^[a-f0-9]{64}$/)
  })

  it.each([
    ['evidenceRef inventada', (value: TerritorialSemanticResolutionV1) => { value.evidenceRefs = ['inventada']; return value }, 'unknown_evidence'],
    ['candidateId inexistente', (value: TerritorialSemanticResolutionV1) => { value.observations[0]!.candidateId = 'missing'; return value }, 'unknown_candidate'],
    ['sourceFeatureId ajeno', (value: TerritorialSemanticResolutionV1) => { value.observations[0]!.sourceFeatureIds = ['other-feature']; return value }, 'unknown_feature'],
    ['literal inventado', (value: TerritorialSemanticResolutionV1) => { value.observations[0]!.literals.use = 'inventado'; return value }, 'invented_literal'],
  ])('rechaza %s', (_name, mutate, code) => {
    const input = penamoaInput()
    const result = validateTerritorialSemanticResolution(mutate(validResolution(input)), input)
    expect(result.valid).toBe(false)
    expect(result.errors.some((item) => item.code === code)).toBe(true)
  })

  it('rechaza evidencia que pertenece a otro candidato o instrumento', () => {
    const input = penamoaInput()
    input.evidencePackets[0]!.candidateIds = ['other-candidate']
    const result = validateTerritorialSemanticResolution(validResolution(input), input)
    expect(result.errors.some((item) => item.code === 'evidence_mismatch')).toBe(true)
  })

  it('rechaza una identidad inexistente, no ACCEPTED o de otro instrumento', () => {
    const input = penamoaInput()
    const base = validResolution(input)
    base.observations[0]!.normativeIdentity = { identityId: 'missing', identity: 'ORD-1', status: 'accepted' }
    expect(validateTerritorialSemanticResolution(base, input).errors.some((item) => item.code === 'unknown_identity')).toBe(true)

    base.observations[0]!.normativeIdentity = { identityId: '27775:ordinance:review', identity: 'ORD-REVIEW', status: 'accepted' }
    expect(validateTerritorialSemanticResolution(base, input).errors.some((item) => item.code === 'identity_not_accepted')).toBe(true)

    input.catalogIdentities[0]!.instrumentId = 'other-instrument'
    base.observations[0]!.normativeIdentity = { identityId: '27775:ordinance:accepted', identity: 'ORD-1', status: 'accepted' }
    expect(validateTerritorialSemanticResolution(base, input).errors.some((item) => item.code === 'identity_instrument_mismatch')).toBe(true)
  })

  it('mantiene la cobertura fuera de la salida y rechaza intentos de modificarla', () => {
    const input = penamoaInput()
    const malicious = { ...validResolution(input), coverage: { parcelPercentage: 100 }, observations: [{ ...validResolution(input).observations[0], intersectionGeometry: {} }] }
    const result = validateTerritorialSemanticResolution(malicious, input)
    expect(result.errors.some((item) => item.code === 'coverage_mutation')).toBe(true)
  })

  it('rechaza accepted cuando existe contradicción material', () => {
    const input = penamoaInput()
    input.existingContradictions = ['La fuente A contradice la fuente B']
    const result = validateTerritorialSemanticResolution(validResolution(input), input)
    expect(result.errors.some((item) => item.code === 'contradiction_status')).toBe(true)
  })

  it('permite estados de revisión, unknown y abstención sin convertirlos en accepted', () => {
    const input = penamoaInput()
    for (const status of ['review_required', 'unknown', 'abstained'] as const) {
      const resolution = validResolution(input)
      resolution.status = status
      resolution.canonical = {}
      resolution.observations = []
      resolution.abstentionReason = `estado ${status}`
      expect(validateTerritorialSemanticResolution(resolution, input).valid).toBe(true)
    }
  })

  it('rechaza JSON malformado y campos no contractuales', () => {
    const input = penamoaInput()
    expect(parseAndValidateTerritorialSemanticResolution('{', input).errors[0]?.code).toBe('malformed')
    const malformed = { ...validResolution(input), unexpected: true }
    expect(validateTerritorialSemanticResolution(malformed, input).errors.some((item) => item.code === 'unknown_field')).toBe(true)
  })

  it('valida una resolución multizona por candidato y no mezcla sus features', () => {
    const input = penamoaInput()
    input.candidates.push({
      ...input.candidates[0]!,
      candidateId: 'siotuga:OTHER|OTHER',
      sourceFeatureIds: ['27775:feature:2'],
      literals: { homogeneousClassification: 'OTHER', homogeneousCategory: 'OTHER', denomination: 'ZONE-2' },
    })
    input.evidencePackets.push({
      ...input.evidencePackets[0]!,
      packetId: 'wfs:27775:feature:2',
      candidateIds: ['siotuga:OTHER|OTHER'],
      sourceFeatureIds: ['27775:feature:2'],
      text: 'feature multizona independiente',
    })
    const resolution = validResolution(input)
    resolution.observations.push({
      candidateId: 'siotuga:OTHER|OTHER',
      sourceFeatureIds: ['27775:feature:2'],
      literals: { ...input.candidates[1]!.literals },
      evidenceRefs: ['wfs:27775:feature:2'],
      contradictions: [],
    })
    resolution.evidenceRefs.push('wfs:27775:feature:2')
    expect(validateTerritorialSemanticResolution(resolution, input).valid).toBe(true)
  })
})
