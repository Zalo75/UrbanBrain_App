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
        { source: 'siotuga', sourceUrl: 'https://official.test/siotuga/instrument', retrievedAt: '2026-07-21T00:00:00Z', method: 'catálogo oficial', scope: 'planning_instrument' },
        { source: 'siotuga', sourceUrl: 'https://official.test/siotuga/classification', retrievedAt: '2026-07-21T00:00:00Z', method: 'WFS oficial', scope: 'planning_classification' },
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

  it('confirma el instrumento parcial de Betanzos sin confirmar clasificación ni detalles no resueltos', () => {
    const confirmations = territorialFieldConfirmations(resolution({
      municipality: 'Betanzos',
      municipalityCode: '15009',
      planning: {
        status: 'partial',
        instrument: 'Texto refundido de la revisión de las Normas Subsidiarias de Planeamiento',
        evidence: [
          {
            source: 'siotuga',
            sourceUrl: 'https://siotuga.xunta.gal/siotuga/inventario.php?inv=1&idconcello=15009',
            retrievedAt: '2026-07-21T00:00:00Z',
            method: 'registro municipal versionado',
            scope: 'planning_instrument',
          },
        ],
        warnings: [],
      },
    }))

    expect(confirmations.planning).toBe('confirmed')
    expect(confirmations.classification).toBe('pending')
  })

  it('mantiene la abstención espacial de Betanzos aunque su instrumento actual esté confirmado por separado', () => {
    const instrument = 'Texto refundido de la revisión de las Normas Subsidiarias de Planeamiento'
    const confirmations = territorialFieldConfirmations(resolution({
      municipality: 'Betanzos',
      municipalityCode: '15009',
      planning: {
        status: 'conflict',
        instrument,
        applicableInstruments: [
          {
            id: '22221',
            name: instrument,
            kind: 'Normas Subsidiarias de Planeamiento',
            status: 'current',
            sourceUrl: 'https://siotuga.xunta.gal/siotuga/inventario.php?inv=1&idconcello=15009',
          },
        ],
        evidence: [
          {
            source: 'siotuga',
            sourceUrl: 'https://siotuga.xunta.gal/siotuga/inventario.php?inv=1&idconcello=15009',
            retrievedAt: '2026-07-21T00:00:00Z',
            method: 'registro municipal versionado',
            scope: 'planning_instrument',
          },
        ],
        conflicts: ['La geometría intersecta clasificaciones incompatibles.'],
        warnings: [],
      },
    }))

    expect(confirmations.planning).toBe('confirmed')
    expect(confirmations.classification).toBe('pending')
  })

  it.each([
    {
      name: 'instrumento sin evidencia oficial',
      planning: { status: 'partial' as const, instrument: 'PXOM', evidence: [], warnings: [] },
    },
    {
      name: 'estado no determinado',
      planning: {
        status: 'not_determined' as const,
        instrument: 'PXOM',
        evidence: [{ source: 'siotuga' as const, sourceUrl: 'https://official.test', retrievedAt: '2026-07-21T00:00:00Z', method: 'catálogo', scope: 'planning_instrument' as const }],
        warnings: [],
      },
    },
    {
      name: 'conflicto sin instrumento current independiente',
      planning: {
        status: 'conflict' as const,
        instrument: 'PXOM',
        evidence: [{ source: 'siotuga' as const, sourceUrl: 'https://official.test', retrievedAt: '2026-07-21T00:00:00Z', method: 'catálogo', scope: 'planning_instrument' as const }],
        warnings: [],
      },
    },
    {
      name: 'evidencia SIOTUGA sólo de clasificación',
      planning: {
        status: 'partial' as const,
        instrument: 'PXOM',
        evidence: [{ source: 'siotuga' as const, sourceUrl: 'https://official.test', retrievedAt: '2026-07-21T00:00:00Z', method: 'WFS', scope: 'planning_classification' as const }],
        warnings: [],
      },
    },
    {
      name: 'instrumento vacío',
      planning: {
        status: 'partial' as const,
        instrument: '   ',
        evidence: [{ source: 'siotuga' as const, sourceUrl: 'https://official.test', retrievedAt: '2026-07-21T00:00:00Z', method: 'catálogo', scope: 'planning_instrument' as const }],
        warnings: [],
      },
    },
  ])('deja pendiente $name', ({ planning }) => {
    expect(territorialFieldConfirmations(resolution({ planning })).planning).toBe('pending')
  })

  it('rechaza de forma cerrada un estado futuro desconocido', () => {
    const result = resolution()
    result.planning.status = 'future_status' as typeof result.planning.status
    expect(territorialFieldConfirmations(result).planning).toBe('pending')
  })
})
