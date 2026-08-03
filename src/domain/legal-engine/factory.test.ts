import { describe, it, expect } from 'vitest'
import { createEvaluatedSituation, createUrbanisticFact } from './factory'

describe('EvaluatedUrbanisticSituation Factory', () => {
  it('creates a valid situation with required parameters', () => {
    const situation = createEvaluatedSituation({
      id: 'sit-123',
      referenceDate: '2026-08-03T00:00:00Z',
      jurisdiction: { municipalityCode: '15009' },
      territorialScope: { id: 'scope-1', type: 'parcel', cadastralReference: '1234567AB' }
    })

    expect(situation.id).toBe('sit-123')
    expect(situation.jurisdiction.municipalityCode).toBe('15009')
    expect(situation.territorialScope.type).toBe('parcel')
  })

  it('includes optional parameters when provided', () => {
    const situation = createEvaluatedSituation({
      id: 'sit-456',
      referenceDate: '2026-08-03T00:00:00Z',
      jurisdiction: { municipalityCode: '15031', provinceCode: '15' },
      territorialScope: { id: 'scope-2', type: 'geometry' },
      expedienteId: 'exp-99',
      action: { type: 'build', description: 'New house' }
    })

    expect(situation.expedienteId).toBe('exp-99')
    expect(situation.action?.type).toBe('build')
  })

  it('throws an error if required fields are missing', () => {
    expect(() => {
      createEvaluatedSituation({
        id: '',
        referenceDate: '2026-08-03T00:00:00Z',
        jurisdiction: { municipalityCode: '15031' },
        territorialScope: { id: 'scope-2', type: 'geometry' }
      })
    }).toThrow('id is required')
  })
})

describe('UrbanisticFact Factory', () => {
  it('creates a valid urbanistic fact', () => {
    const fact = createUrbanisticFact({
      id: 'fact-1',
      situationId: 'sit-1',
      property: 'classification',
      value: 'urbano',
      createdAt: '2026-08-03T00:00:00Z'
    })
    expect(fact.id).toBe('fact-1')
    expect(fact.value).toBe('urbano')
  })

  it('throws if required fields are missing', () => {
    expect(() => {
      createUrbanisticFact({
        id: '',
        situationId: 'sit-1',
        property: 'classification',
        value: 'urbano',
        createdAt: '2026-08-03T00:00:00Z'
      })
    }).toThrow('id is required')
  })
})
