import { describe, expect, it } from 'vitest'
import type { NormalizedParcelContext } from '@/domain/parcel-context/types'
import type { UrbanisticRegimeFacts } from '@/domain/territorial-resolver/types'
import { deriveParcelRegimeIdentity } from './parcelRegimeIdentity'

const evidence = [{
  source: 'siotuga' as const,
  sourceUrl: 'https://official.test/planning',
  retrievedAt: '2026-01-01T00:00:00.000Z',
  method: 'official fixture',
  scope: 'planning_classification' as const,
}]

function facts(options: Partial<UrbanisticRegimeFacts['category']> = {}): UrbanisticRegimeFacts {
  return {
    classification: {
      value: { code: 'SU', label: 'Suelo urbano' },
      label: 'Suelo urbano',
      status: 'automatic_confirmed',
      origin: 'spatial_intersection',
      confidence: 'high',
      evidence,
      warnings: [],
      discrepancies: [],
      nextAction: 'none',
      instrumentId: 'instrument-1',
    },
    category: {
      value: { code: 'O1', label: 'Ordenanza O1' },
      label: 'Ordenanza O1',
      status: 'automatic_confirmed',
      origin: 'spatial_intersection',
      confidence: 'high',
      evidence,
      warnings: [],
      discrepancies: [],
      nextAction: 'none',
      instrumentId: 'instrument-1',
      ...options,
    },
    consolidation: {
      status: 'not_applicable',
      confidence: 'unknown',
      evidence,
      warnings: [],
      discrepancies: [],
      nextAction: 'none',
    },
  }
}

function context(overrides: Partial<NormalizedParcelContext> = {}): NormalizedParcelContext {
  return {
    municipality: { value: { name: 'Municipio', ineCode: '00000' }, source: 'catastro', confidence: 0.98, verification: 'confirmed' },
    cadastralReference: { value: '00000A00000000', source: 'catastro', confidence: 0.98, verification: 'confirmed' },
    landClass: { value: 'urbano_consolidado', source: 'siotuga', confidence: 0.95, verification: 'confirmed' },
    qualification: { value: 'O1', source: 'siotuga', confidence: 0.95, verification: 'confirmed' },
    planningArea: { value: 'O1', source: 'siotuga', confidence: 0.95, verification: 'confirmed' },
    planningInstrument: { value: 'Instrumento vigente', source: 'siotuga', confidence: 0.95, verification: 'confirmed' },
    validity: { value: 'vigente', source: 'siotuga', confidence: 0.95, verification: 'confirmed' },
    canAnswerConcreteParameters: true,
    urbanisticFacts: facts(),
    knownConstraints: [],
    conflicts: [],
    pendingValidation: [],
    ...overrides,
  }
}

describe('deriveParcelRegimeIdentity', () => {
  it('derives an automatic confirmed regime without inventing provenance', () => {
    const result = deriveParcelRegimeIdentity(context())
    expect(result.status).toBe('automatic')
    expect(result.scopes[0]).toMatchObject({
      qualification: 'O1',
      planningArea: 'O1',
      instrumentId: 'instrument-1',
      status: 'automatic',
    })
    expect(result.scopes[0].evidence).toEqual(evidence)
  })

  it('keeps probable and unverified contexts in review', () => {
    const probable = deriveParcelRegimeIdentity(context({
      urbanisticFacts: facts({ status: 'automatic_probable' }),
    }))
    const unverified = deriveParcelRegimeIdentity(context({
      qualification: { value: 'O1', source: 'manual', confidence: 0.55, verification: 'unverified' },
      canAnswerConcreteParameters: false,
    }))
    expect(probable.status).toBe('review')
    expect(unverified.status).toBe('review')
  })

  it('marks technician validated facts as effective and preserves automatic candidates', () => {
    const result = deriveParcelRegimeIdentity(context({
      urbanisticFacts: {
        ...facts({
          status: 'technician_validated',
          candidates: [{ value: { code: 'O2', label: 'Ordenanza O2' }, parcelPercentage: 100 }],
        }),
        classification: { ...facts().classification, status: 'technician_validated', origin: 'technician_confirmation' },
      },
      qualification: { value: 'O2', source: 'manual', confidence: 0.98, verification: 'confirmed' },
      planningArea: { value: 'O2', source: 'manual', confidence: 0.98, verification: 'confirmed' },
    }))
    expect(result.status).toBe('effective')
    expect(result.scopes[0].automaticCandidates).toEqual([
      { code: 'O2', label: 'Ordenanza O2', parcelPercentage: 100, intersectionAreaSquareMetres: undefined },
    ])
  })

  it('keeps multizone candidates as separate scopes', () => {
    const result = deriveParcelRegimeIdentity(context({
      urbanisticFacts: facts({
        status: 'conflict',
        value: undefined,
        candidates: [
          { value: { code: 'O1', label: 'O1' }, parcelPercentage: 98 },
          { value: { code: 'O2', label: 'O2' }, parcelPercentage: 2 },
        ],
      }),
    }))
    expect(result.status).toBe('review')
    expect(result.scopes).toHaveLength(2)
    expect(result.scopes.map((scope) => scope.category?.code)).toEqual(['O1', 'O2'])
    expect(result.scopes.map((scope) => scope.category?.parcelPercentage)).toEqual([98, 2])
  })

  it('does not combine incompatible qualification and planning area', () => {
    const result = deriveParcelRegimeIdentity(context({
      qualification: { value: 'O1', source: 'manual', confidence: 0.95, verification: 'confirmed' },
      planningArea: { value: 'AREA-2', source: 'siotuga', confidence: 0.95, verification: 'confirmed' },
    }))
    expect(result.status).toBe('review')
    expect(result.conflicts).toContain('La ordenanza/calificación y el ámbito proceden de decisiones o fuentes distintas.')
  })

  it('returns unresolved when no regime evidence exists', () => {
    const result = deriveParcelRegimeIdentity({
      knownConstraints: [],
      conflicts: [],
      pendingValidation: [],
    })
    expect(result.status).toBe('unresolved')
    expect(result.scopes).toHaveLength(0)
  })
})
