import { describe, expect, it } from 'vitest'

import type { TerritorialResolution } from '@/domain/territorial-resolver/types'

import { territorialFieldConfirmations } from './fieldConfirmations'

function resolution(overrides: Partial<TerritorialResolution> = {}): TerritorialResolution {
  return {
    status: 'confirmed',
    confidence: 'high',
    inputMethod: 'cadastral_reference',
    cadastralReference: '7709702NH4970N0001SZ',
    municipality: 'Culleredo',
    municipalityCode: '15031',
    province: 'A Coruña',
    coordinates: { lat: 43.316, lng: -8.336 },
    candidates: [],
    evidence: [
      { source: 'catastro', sourceUrl: 'https://official.test/catastro', retrievedAt: '2026-07-21T00:00:00Z', method: 'fixture' },
    ],
    warnings: [],
    conflicts: [],
    planning: {
      status: 'determined',
      instrument: 'PXOM de Culleredo',
      classification: { code: 'SU', label: 'Suelo urbano', sourceFeatureIds: ['zone-1'] },
      evidence: [
        { source: 'siotuga', sourceUrl: 'https://official.test/siotuga', retrievedAt: '2026-07-21T00:00:00Z', method: 'fixture' },
      ],
      warnings: [],
    },
    affects: { analysisGeometry: 'parcel', detected: [], canRuleOutUndetectedAffects: false, warnings: [] },
    resolvedAt: '2026-07-21T00:00:00Z',
    ...overrides,
  }
}

describe('territorial field confirmations', () => {
  it('confirms only fields supported by coherent Catastro and SIOTUGA evidence', () => {
    expect(territorialFieldConfirmations(resolution())).toEqual({
      cadastralReference: 'confirmed',
      coordinates: 'confirmed',
      municipality: 'confirmed',
      municipalityCode: 'confirmed',
      province: 'confirmed',
      planning: 'confirmed',
      classification: 'confirmed',
    })
  })

  it('keeps inferred point data and incomplete planning pending', () => {
    expect(territorialFieldConfirmations(resolution({
      status: 'probable',
      evidence: [{ source: 'cartociudad', sourceUrl: 'https://official.test/cartociudad', retrievedAt: '2026-07-21T00:00:00Z', method: 'fixture' }],
      planning: { status: 'partial', instrument: 'PXOM de Culleredo', evidence: [], warnings: [] },
    }))).toEqual({
      cadastralReference: 'pending',
      coordinates: 'pending',
      municipality: 'pending',
      municipalityCode: 'pending',
      province: 'pending',
      planning: 'pending',
      classification: 'pending',
    })
  })
})
