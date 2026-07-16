import { describe, expect, it } from 'vitest'

import type { TerritorialContextView } from '@/application/territorial-resolver/territorialContextView'
import { buildTerritorialPresentation } from './territorialPresentation'

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
})
