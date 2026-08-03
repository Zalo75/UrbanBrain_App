import { describe, it, expect } from 'vitest'
import { adaptLegacyParcelContextToSituation } from './legacyAdapter'
import type { NormalizedParcelContext } from '@/domain/parcel-context/types'

describe('legacyAdapter', () => {
  it('adapts a NormalizedParcelContext to an EvaluatedUrbanisticSituation', () => {
    const mockLegacyContext: NormalizedParcelContext = {
      cadastralReference: { value: '12345A', source: 'catastro', confidence: 1, verification: 'confirmed' },
      municipality: { value: { name: 'Betanzos', ineCode: '15009' }, source: 'catastro', confidence: 1, verification: 'confirmed' },
      address: { value: 'Calle Falsa 123', source: 'catastro', confidence: 1, verification: 'confirmed' },
      knownConstraints: [],
      conflicts: [],
      pendingValidation: []
    }

    const situation = adaptLegacyParcelContextToSituation(
      mockLegacyContext,
      'sit-1',
      '2026-08-03T12:00:00Z',
      'exp-1'
    )

    expect(situation.id).toBe('sit-1')
    expect(situation.referenceDate).toBe('2026-08-03T12:00:00Z')
    expect(situation.expedienteId).toBe('exp-1')
    expect(situation.jurisdiction.municipalityCode).toBe('15009')
    expect(situation.territorialScope.cadastralReference).toBe('12345A')
    expect(situation.territorialScope.description).toBe('Calle Falsa 123')
  })
})
