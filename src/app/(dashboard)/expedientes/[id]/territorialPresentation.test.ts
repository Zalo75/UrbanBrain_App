import { describe, expect, it } from 'vitest'

import type { TerritorialContextView } from '@/application/territorial-resolver/territorialContextView'
import {
  buildTerritorialPresentation,
  getUrbanContextAttention,
} from './territorialPresentation'

function detectedContext(
  overrides: Partial<TerritorialContextView> = {}
): TerritorialContextView {
  return {
    status: 'confirmed',
    confidence: 'high',
    resolvedAt: '2026-07-16T10:00:00.000Z',
    inputMethod: 'coordinates',
    province: 'A Coruña',
    municipality: 'Betanzos',
    coordinates: { lat: 43.271234, lng: -8.217654 },
    areas: [],
    affects: [],
    conflicts: [],
    warnings: [],
    sources: [],
    canAnswerConcreteParameters: false,
    canRuleOutUndetectedAffects: false,
    candidateCount: 0,
    latestAttemptAt: '2026-07-16T10:00:00.000Z',
    usingPreviousOfficialContext: false,
    technicallyReviewed: false,
    sourceChecks: [],
    ...overrides,
  }
}

describe('buildTerritorialPresentation', () => {
  it('prioriza la última detección frente a las coordenadas aproximadas del expediente', () => {
    expect(
      buildTerritorialPresentation(
        { province: 'Provincia inicial', municipality: 'Municipio inicial', lat: 43, lng: -8 },
        detectedContext()
      )
    ).toMatchObject({
      province: 'A Coruña',
      municipality: 'Betanzos',
      coordinates: { lat: 43.271234, lng: -8.217654 },
      technicallyReviewed: false,
    })
  })

  it('solo muestra revisión cuando la detección contiene validación técnica explícita', () => {
    expect(
      buildTerritorialPresentation(
        { province: 'A Coruña', municipality: 'Betanzos', lat: 43, lng: -8 },
        detectedContext({ technicallyReviewed: true })
      ).technicallyReviewed
    ).toBe(true)
  })

  it('no mezcla parámetros declarados del expediente con un contexto detectado no determinado', () => {
    const presentation = buildTerritorialPresentation(
      {
        province: 'A Coruña',
        municipality: 'Betanzos',
        planning: 'Planeamiento declarado',
        zone: 'Zona declarada',
        landClass: 'Clase declarada',
      },
      detectedContext({
        status: 'undetermined',
        instrument: undefined,
        areas: [],
        classification: undefined,
      })
    )

    expect(presentation).toMatchObject({
      planning: undefined,
      zone: undefined,
      landClass: undefined,
    })
  })

  it('identifica específicamente la zona pendiente cuando planeamiento y clasificación existen', () => {
    expect(
      getUrbanContextAttention({
        planning: 'Plan general de ordenación urbana',
        landClass: 'Suelo urbano',
      })
    ).toEqual({
      kind: 'zone_pending',
      label: 'Zona urbanística pendiente',
      missing: ['zona urbanística u ordenanza aplicable'],
    })
  })

  it('agrupa varias carencias como contexto urbanístico incompleto', () => {
    expect(getUrbanContextAttention({})).toEqual({
      kind: 'incomplete',
      label: 'Contexto urbanístico incompleto',
      missing: [
        'planeamiento',
        'clasificación del suelo',
        'zona urbanística u ordenanza aplicable',
      ],
    })
  })

  it('no solicita completar el contexto cuando los tres datos están determinados', () => {
    expect(
      getUrbanContextAttention({
        planning: 'Plan general de ordenación urbana',
        landClass: 'Suelo urbano',
        zone: 'Ordenanza 3',
      })
    ).toBeNull()
  })

  it('reconoce una ordenanza manual existente sin perder su procedencia', () => {
    const presentation = buildTerritorialPresentation(
      { province: 'A Coruña', municipality: 'Culleredo' },
      detectedContext({
        instrument: 'Plan general de ordenación urbana',
        classification: {
          code: 'SU',
          label: 'Suelo urbano',
          sourceFeatureIds: [],
        },
        manualContext: {
          ordinance: 'Ordenanza 3',
          provenance: 'manual',
          verification: 'unverified',
          recordedAt: '2026-07-16T10:00:00.000Z',
        },
      })
    )

    expect(presentation.zone).toBe('Ordenanza 3')
    expect(presentation.urbanContextAttention).toBeNull()
  })
})
