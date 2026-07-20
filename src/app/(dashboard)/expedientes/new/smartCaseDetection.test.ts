import { describe, expect, it } from 'vitest'

import type { TerritorialResolution } from '@/domain/territorial-resolver/types'
import { allMunicipalities } from '@/shared/territory'

import {
  municipalitiesForProvince,
  summarizeSmartCaseDetection,
  validateSmartCaseSubmission,
} from './smartCaseDetection'

function resolution(overrides: Partial<TerritorialResolution> = {}): TerritorialResolution {
  return {
    status: 'confirmed',
    confidence: 'high',
    inputMethod: 'cadastral_reference',
    cadastralReference: '7709702NH4970N0001SZ',
    parcelReference: '7709702NH4970N',
    normalizedAddress: 'LG LEDOÑO CULLEREDO (A CORUÑA)',
    municipality: 'Culleredo',
    municipalityCode: '15031',
    province: 'A Coruña',
    coordinates: { lat: 43.316, lng: -8.336 },
    candidates: [],
    evidence: [{ source: 'catastro', sourceUrl: 'https://official.test', retrievedAt: '2026-07-20T00:00:00.000Z', method: 'fixture' }],
    warnings: [],
    conflicts: [],
    planning: {
      status: 'determined',
      instrument: 'Plan general trazable',
      classification: { code: 'SU', label: 'Suelo urbano', sourceFeatureIds: ['class-1'] },
      evidence: [],
      warnings: [],
    },
    affects: {
      analysisGeometry: 'parcel',
      detected: [],
      canRuleOutUndetectedAffects: false,
      warnings: [],
      sourceChecks: [{ source: 'ideg', status: 'available', checkedAt: '2026-07-20T00:00:00.000Z', message: 'IDEG consultada' }],
    },
    resolvedAt: '2026-07-20T00:00:00.000Z',
    ...overrides,
  }
}

describe('smart case detection', () => {
  it('autoselecciona Culleredo por INE y mantiene RC completa y parcelaria', () => {
    const detected = summarizeSmartCaseDetection(resolution())

    expect(detected.detected).toMatchObject({
      municipalityId: 'culleredo',
      municipalityCode: '15031',
      cadastralReference: '7709702NH4970N0001SZ',
      parcelReference: '7709702NH4970N',
    })
  })

  it('filtra el selector municipal por provincia y rechaza combinaciones incompatibles', () => {
    const aCoruna = municipalitiesForProvince(allMunicipalities, 'a_coruna')
    expect(aCoruna.every((municipality) => municipality.provinceId === 'a_coruna')).toBe(true)
    expect(validateSmartCaseSubmission({ provinceId: 'lugo', municipalityId: 'culleredo' })).toBe('municipality_province_mismatch')
  })

  it('no marca como correcto lo no determinado y conserva un error IDEG como comprobación incompleta', () => {
    const detected = summarizeSmartCaseDetection(resolution({
      planning: { status: 'not_determined', evidence: [], warnings: [] },
      affects: {
        analysisGeometry: 'parcel',
        detected: [],
        canRuleOutUndetectedAffects: false,
        warnings: [],
        sourceChecks: [{ source: 'ideg', status: 'timeout', checkedAt: '2026-07-20T00:00:00.000Z', message: 'IDEG no responde' }],
      },
    }))

    expect(detected.progress.find((item) => item.id === 'planning')).toMatchObject({ status: 'not_determined' })
    expect(detected.progress.find((item) => item.id === 'classification')).toMatchObject({ status: 'not_determined' })
    expect(detected.progress.find((item) => item.id === 'affects')).toMatchObject({ status: 'incomplete' })
    expect(detected.progress.find((item) => item.id === 'affects')?.detail).not.toMatch(/sin afecciones/i)
  })

  it('acepta clasificaciones normalizadas manuales y bloquea valores del resultado alterados', () => {
    const detected = summarizeSmartCaseDetection(resolution())
    expect(validateSmartCaseSubmission({
      provinceId: 'a_coruna', municipalityId: 'culleredo', cadastralReference: '7709702NH4970N0001SZ',
      address: 'LG LEDOÑO CULLEREDO (A CORUÑA)', lat: 43.316, lng: -8.336,
      planeamiento: 'Plan general trazable', landClass: 'urbano_consolidado',
    }, detected)).toBeNull()
    expect(validateSmartCaseSubmission({
      provinceId: 'a_coruna', municipalityId: 'culleredo', cadastralReference: '7709702NH4970N0001SZ',
      address: 'LG LEDOÑO CULLEREDO (A CORUÑA)', lat: 43.316, lng: -8.336,
      planeamiento: 'Valor alterado', landClass: 'urbano_consolidado',
    }, detected)).toBe('detection_mismatch')
  })
})
