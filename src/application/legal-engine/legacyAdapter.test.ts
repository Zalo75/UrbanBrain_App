import { describe, it, expect } from 'vitest'
import { adaptLegacyParcelContextToSituation, adaptLegacyFactToV2, adaptLegacyEvidenceToV2, adaptLegacyValidityToV2 } from './legacyAdapter'
import type { NormalizedParcelContext } from '@/domain/parcel-context/types'
import type { UrbanisticFact as LegacyUrbanisticFact, TerritorialEvidence } from '@/domain/territorial-resolver/types'

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

describe('adaptLegacyFactToV2', () => {
  it('adapts a legacy fact with object value to v2 string value', () => {
    const legacy: LegacyUrbanisticFact<{ code: string }> = {
      value: { code: 'SUC' },
      status: 'automatic_confirmed',
      confidence: 'high',
      evidence: [],
      warnings: [],
      discrepancies: [],
      nextAction: 'none'
    }

    const v2 = adaptLegacyFactToV2(legacy, 'fact-1', 'sit-1', 'category', '2026-08-03T12:00:00Z')
    expect(v2?.value).toBe('SUC')
    expect(v2?.property).toBe('category')
  })

  it('returns null if legacy fact has no value', () => {
    const legacy: LegacyUrbanisticFact<any> = {
      status: 'not_available',
      confidence: 'unknown',
      evidence: [],
      warnings: [],
      discrepancies: [],
      nextAction: 'none'
    }
    const v2 = adaptLegacyFactToV2(legacy, 'f', 's', 'classification', '2026-08-03T12:00:00Z')
    expect(v2).toBeNull()
  })
})

describe('adaptLegacyEvidenceToV2', () => {
  it('adapts a TerritorialEvidence to an Evidence', () => {
    const legacy: TerritorialEvidence = {
      source: 'catastro',
      sourceUrl: 'https://sedecatastro.gob.es/...',
      retrievedAt: '2026-08-03T10:00:00Z',
      method: 'API_GET',
      scope: 'location'
    }

    const v2 = adaptLegacyEvidenceToV2(legacy, 'ev-1', 'fact-1', '2026-08-03T12:00:00Z')
    expect(v2.id).toBe('ev-1')
    expect(v2.subjectId).toBe('fact-1')
    expect(v2.kind).toBe('official_registry')
    expect(v2.sourceReference).toBe('https://sedecatastro.gob.es/...')
    expect(v2.sourceLocation).toBe('location')
  })
})

describe('adaptLegacyValidityToV2 fail-closed validation', () => {
  it('Estado legacy explícitamente activo -> ACTIVE', () => {
    expect(adaptLegacyValidityToV2('vigente')?.status).toBe('ACTIVE')
    expect(adaptLegacyValidityToV2('activo')?.status).toBe('ACTIVE')
  })

  it('Estado explícitamente futuro -> FUTURE', () => {
    expect(adaptLegacyValidityToV2('futuro')?.status).toBe('FUTURE')
    expect(adaptLegacyValidityToV2('future')?.status).toBe('FUTURE')
  })

  it('Estado explícitamente expirado -> EXPIRED', () => {
    expect(adaptLegacyValidityToV2('derogado')?.status).toBe('EXPIRED')
    expect(adaptLegacyValidityToV2('expirado')?.status).toBe('EXPIRED')
  })

  it('Estado explícitamente suspendido -> SUSPENDED', () => {
    expect(adaptLegacyValidityToV2('suspendido')?.status).toBe('SUSPENDED')
  })

  it('Texto libre sin estado estructurado -> null/undefined', () => {
    expect(adaptLegacyValidityToV2('aprobado definitivamente en 2005, pero con modificaciones en 2012')).toBeNull()
    expect(adaptLegacyValidityToV2('Aprobación inicial')).toBeNull()
  })

  it('Ausencia de datos -> null/undefined', () => {
    expect(adaptLegacyValidityToV2(undefined)).toBeNull()
    expect(adaptLegacyValidityToV2('')).toBeNull()
  })

  it('No se infiere ACTIVE por el mero hecho de existir texto', () => {
    expect(adaptLegacyValidityToV2('cualquier texto')).toBeNull()
  })
})
