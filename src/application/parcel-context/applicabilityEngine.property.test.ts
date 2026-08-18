import { evaluateApplicability } from './applicabilityEngine'
import {
  NormalizedParcelContext,
  NormativeCandidate,
} from '@/domain/parcel-context/types'

function parcel(options: Partial<NormalizedParcelContext> = {}): NormalizedParcelContext {
  return {
    cadastralReference: { value: '1234567AB1234C0001DE', source: 'manual', confidence: 1, verification: 'confirmed' },
    address: { value: 'Calle Falsa 123', source: 'manual', confidence: 1, verification: 'confirmed' },
    municipality: { value: { name: 'Municipio X', id: '1' }, source: 'manual', confidence: 1, verification: 'confirmed' },
    landClass: { value: 'urbano_consolidado', source: 'manual', confidence: 1, verification: 'confirmed' },
    planningInstrument: { value: 'PGOU', source: 'manual', confidence: 1, verification: 'confirmed' },
    validity: { value: 'Vigente', source: 'manual', confidence: 1, verification: 'confirmed' },
    canAnswerConcreteParameters: true,
    conflicts: [],
    knownConstraints: [],
    pendingValidation: [],
    ...options,
  }
}

function candidate(options: Partial<NormativeCandidate> = {}): NormativeCandidate {
  return {
    id: '1',
    content: 'Texto genérico',
    municipalityName: 'Municipio X',
    documentName: 'PGOU',
    title: 'Normativa',
    hierarchy: 'municipal',
    status: 'vigente',
    ...options,
  }
}

describe('Applicability Engine - Property Tests (Municipio X)', () => {
  it('1. O1 parcel + O1 candidate metadata, texto no menciona O1 -> APPLICABLE', () => {
    const ctx = parcel({
      qualification: { value: 'O1', source: 'manual', confidence: 1, verification: 'confirmed' },
    })
    const cand = candidate({
      content: 'Este artículo trata sobre alturas y retranqueos.', // No menciona O1
      regimeMetadata: { kind: 'ordinance', code: 'O1', provenance: 'inherited_heading', confidence: 'medium' }
    })
    
    const res = evaluateApplicability(ctx, [cand], true)
    expect(res.applicable).toHaveLength(1)
    expect(res.status).toBe('DETERMINADO')
  })

  it('2. O1 parcel + O2 candidate -> NO APPLICABLE (REVIEW/REJECTED)', () => {
    const ctx = parcel({
      qualification: { value: 'O1', source: 'manual', confidence: 1, verification: 'confirmed' },
    })
    const cand = candidate({
      regimeMetadata: { kind: 'ordinance', code: 'O2', provenance: 'explicit_heading', confidence: 'high' }
    })
    
    const res = evaluateApplicability(ctx, [cand], true)
    expect(res.applicable).toHaveLength(0)
    expect(res.rejected.some(r => r.candidate.id === cand.id)).toBe(true)
  })

  it('3. O1 parcel + candidate unknown -> REVIEW', () => {
    const ctx = parcel({
      qualification: { value: 'O1', source: 'manual', confidence: 1, verification: 'confirmed' },
    })
    const cand = candidate({
      regimeMetadata: null, // Unknown
      content: 'No menciona ordenanza',
    })
    
    const res = evaluateApplicability(ctx, [cand], true)
    expect(res.applicable).toHaveLength(0)
    expect(res.review).toHaveLength(1)
  })

  it('4. O1 technician_validated + O1 candidate -> APPLICABLE', () => {
    const ctx = parcel({
      canAnswerConcreteParameters: false,
      qualification: { value: 'O1', source: 'manual', confidence: 1, verification: 'confirmed' },
      reliability: {
        mode: 'technician_validated_manual',
        sourceIssues: []
      }
    })
    const cand = candidate({
      regimeMetadata: { kind: 'ordinance', code: 'O1', provenance: 'explicit_heading', confidence: 'high' }
    })
    
    const res = evaluateApplicability(ctx, [cand], true)
    expect(res.applicable).toHaveLength(1)
    // MISSING_REGIME_VALIDATION should be removed
    expect(res.missingData).not.toContain('MISSING_REGIME_VALIDATION')
    expect(res.canAnswerConcreteParameters).toBe(true)
  })

  it('5. O1 technician_validated + O2 candidate -> NO APPLICABLE', () => {
    const ctx = parcel({
      canAnswerConcreteParameters: false,
      qualification: { value: 'O1', source: 'manual', confidence: 1, verification: 'confirmed' },
      reliability: {
        mode: 'technician_validated_manual',
        sourceIssues: []
      }
    })
    const cand = candidate({
      regimeMetadata: { kind: 'ordinance', code: 'O2', provenance: 'explicit_heading', confidence: 'high' }
    })
    
    const res = evaluateApplicability(ctx, [cand], true)
    expect(res.applicable).toHaveLength(0)
    expect(res.rejected).toHaveLength(1)
  })

  it('6. O1 technician_validated + unknown candidate -> REVIEW', () => {
    const ctx = parcel({
      canAnswerConcreteParameters: false,
      qualification: { value: 'O1', source: 'manual', confidence: 1, verification: 'confirmed' },
      reliability: {
        mode: 'technician_validated_manual',
        sourceIssues: []
      }
    })
    const cand = candidate({
      regimeMetadata: null,
      content: 'sin nombre de ordenanza'
    })
    
    const res = evaluateApplicability(ctx, [cand], true)
    expect(res.applicable).toHaveLength(0)
    expect(res.review).toHaveLength(1)
  })

  it('7. Sin metadata estructurada pero texto menciona O1 explícitamente -> mantener fallback', () => {
    const ctx = parcel({
      qualification: { value: 'O1', source: 'manual', confidence: 1, verification: 'confirmed' },
    })
    const cand = candidate({
      regimeMetadata: null,
      content: 'De acuerdo a la ordenanza O1, la altura máxima es...',
    })
    
    const res = evaluateApplicability(ctx, [cand], true)
    expect(res.applicable).toHaveLength(1)
  })

  it('8. General rules sin régimen particular -> no asignarlas a O1 artificialmente', () => {
    const ctx = parcel({
      qualification: { value: 'O1', source: 'manual', confidence: 1, verification: 'confirmed' },
    })
    const cand = candidate({
      regimeMetadata: { kind: 'general', provenance: 'explicit_heading', confidence: 'high' },
      content: 'Disposiciones generales para todo el suelo urbano.',
    })
    
    const res = evaluateApplicability(ctx, [cand], true)
    expect(res.applicable).toHaveLength(1) // General is applicable everywhere
  })
})
