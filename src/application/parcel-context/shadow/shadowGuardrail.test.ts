import { describe, it, expect } from 'vitest'
import { validateShadowFactualResponse } from './shadowGuardrail'
import type { TerritorialFactualContract } from '@/domain/parcel-context/factualContract'

describe('shadowGuardrail', () => {
  const baseContract: TerritorialFactualContract = {
    identity: {},
    scopes: {},
    classification: { status: 'unresolved', determination: 'unresolved' },
    categories: [],
    consolidation: { status: 'unresolved', determination: 'unresolved' },
    planningAreas: [],
    affects: { status: 'unresolved', items: [] },
    normativeReferences: {}
  }

  it('detecta FAIL_OVERCLAIM si se afirma un régimen efectivo que no existe', () => {
    const contract = { ...baseContract } // No 'effective' anywhere
    const answer = 'El régimen legalmente aplicable es el suelo urbano.'
    
    const result = validateShadowFactualResponse(answer, contract)
    expect(result.valid).toBe(false)
    expect(result.reasons[0]).toContain('FAIL_OVERCLAIM')
  })

  it('permite hablar de régimen efectivo si el contrato tiene algo effective', () => {
    const contract: TerritorialFactualContract = {
      ...baseContract,
      classification: { status: 'technician_validated', determination: 'effective', code: 'SU' }
    }
    const answer = 'El régimen legalmente aplicable es el suelo urbano.'
    
    const result = validateShadowFactualResponse(answer, contract)
    expect(result.valid).toBe(true)
  })

  it('detecta FAIL_FACTUAL si se inventan porcentajes', () => {
    const contract: TerritorialFactualContract = {
      ...baseContract,
      categories: [{ code: 'SNRC', status: 'conflict', determination: 'unresolved', parcelPercentage: 98.53 }]
    }
    const answer = 'La parcela tiene un 50% de SNRC.'
    
    const result = validateShadowFactualResponse(answer, contract)
    expect(result.valid).toBe(false)
    expect(result.reasons[0]).toContain('FAIL_FACTUAL')
  })

  it('detecta FAIL_OVERCLAIM si se afirma clasificación estando unresolved', () => {
    const contract = { ...baseContract } // classification unresolved
    const answer = 'La clasificación es SU.'
    
    const result = validateShadowFactualResponse(answer, contract)
    expect(result.valid).toBe(false)
    expect(result.reasons[0]).toContain('FAIL_OVERCLAIM')
  })
})
