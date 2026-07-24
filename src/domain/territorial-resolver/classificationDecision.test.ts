import { describe, expect, it } from 'vitest'

import {
  evaluateClassificationResolution,
  type EvaluateClassificationInput,
} from './classificationDecision'
import type {
  ClassificationCandidate,
  ClassificationSourceCheck,
} from './types'

const checkedAt = '2026-07-24T10:00:00.000Z'

const availableCheck: ClassificationSourceCheck = {
  source: 'siotuga',
  status: 'available',
  checkedAt,
  message: 'La fuente oficial respondio correctamente.',
  requiredForAutomaticDecision: true,
}

function candidate(
  id: string,
  classificationCode: string,
  categoryCode: string,
  overrides: Partial<ClassificationCandidate> = {}
): ClassificationCandidate {
  return {
    id,
    classification: {
      code: classificationCode,
      categoryCode,
      label: classificationCode,
      categoryLabel: categoryCode,
      sourceFeatureIds: [`feature-${id}`],
    },
    areas: [{ type: 'zone', name: `Ambito ${id}`, sourceFeatureIds: [`feature-${id}`] }],
    source: 'siotuga',
    evidence: [
      {
        source: 'siotuga',
        sourceUrl: 'https://siotuga.xunta.gal/official',
        retrievedAt: checkedAt,
        method: 'WFS con interseccion parcelaria',
        scope: 'planning_classification',
      },
    ],
    confidence: 'high',
    evidenceBasis: 'parcel_geometry',
    instrumentTraceability: 'verified',
    normalizationStatus: 'mapped',
    ...overrides,
  }
}

function evaluate(overrides: Partial<EvaluateClassificationInput>) {
  return evaluateClassificationResolution({
    candidates: [],
    sourceChecks: [availableCheck],
    ...overrides,
  })
}

describe('evaluateClassificationResolution', () => {
  it('selecciona automaticamente una clasificacion clara y conserva su evidencia', () => {
    const culleredo = candidate('culleredo-su-susc', 'SU', 'SUSC', {
      areas: [{ type: 'zone', name: 'LEDOÑO', sourceFeatureIds: ['feature-culleredo'] }],
    })

    const result = evaluate({ candidates: [culleredo] })

    expect(result.status).toBe('clear')
    expect(result.nextAction).toBe('auto_accept')
    expect(result.candidates).toEqual([culleredo])
    expect(result.evidence).toEqual(culleredo.evidence)
    expect(result.automaticSelection).toEqual(
      expect.objectContaining({
        candidateId: culleredo.id,
        classificationCode: 'SU',
        categoryCode: 'SUSC',
        areaNames: ['LEDOÑO'],
      })
    )
    expect(result.proposal).toBeUndefined()
  })

  it('trata dos intersecciones parcelarias reales como multiples y no como conflicto', () => {
    const first = candidate('first', 'SU', 'SUC')
    const second = candidate('second', 'SNR', 'SNRSC')

    const result = evaluate({ candidates: [first, second] })

    expect(result.status).toBe('multiple_intersections')
    expect(result.nextAction).toBe('manual_selection')
    expect(result.candidates).toEqual([first, second])
    expect(result.reviewReasons).toEqual([])
    expect(result.automaticSelection).toBeUndefined()
    expect(result.proposal).toBeUndefined()
  })

  it('conserva Oleiros pero exige revision si la capa no es trazable al instrumento', () => {
    const oleiros = candidate('oleiros-su-suc', 'SU', 'SUC', {
      instrumentTraceability: 'pending',
    })

    const result = evaluate({ candidates: [oleiros] })

    expect(result.status).toBe('review_required')
    expect(result.nextAction).toBe('review_official_sources')
    expect(result.candidates).toEqual([oleiros])
    expect(result.reviewReasons).toContain('instrument_traceability_pending')
    expect(result.proposal).toEqual(
      expect.objectContaining({ candidateId: oleiros.id, requiresProfessionalReview: true })
    )
    expect(result.automaticSelection).toBeUndefined()
  })

  it('prioriza en Betanzos la evidencia geometrica sin ocultar la discrepancia con el punto', () => {
    const geometry = candidate('betanzos-geometry', 'SNR', 'SNRSC', {
      areas: [{ type: 'nucleus', name: 'CASCAS', sourceFeatureIds: ['betanzos-geometry'] }],
    })
    const point = candidate('betanzos-point', 'SU', 'SUC', {
      confidence: 'medium',
      evidenceBasis: 'representative_point',
    })

    const result = evaluate({
      candidates: [geometry, point],
      discrepancies: [
        {
          reason: 'point_geometry_mismatch',
          field: 'classification',
          explanation: 'El punto y la geometria completa no devuelven la misma clasificacion.',
          assertions: [
            { candidateId: geometry.id, value: 'SNR/SNRSC', source: 'siotuga', evidence: geometry.evidence },
            { candidateId: point.id, value: 'SU/SUC', source: 'siotuga', evidence: point.evidence },
          ],
        },
      ],
    })

    expect(result.status).toBe('review_required')
    expect(result.nextAction).toBe('review_official_sources')
    expect(result.candidates).toHaveLength(2)
    expect(result.reviewReasons).toContain('point_geometry_mismatch')
    expect(result.proposal?.candidateId).toBe(geometry.id)
    expect(result.proposal?.requiresProfessionalReview).toBe(true)
  })

  it('distingue una respuesta oficial sin resultados de un fallo de la fuente', () => {
    const notAvailable = evaluate({ candidates: [] })
    expect(notAvailable.status).toBe('not_available')
    expect(notAvailable.nextAction).toBe('manual_selection')

    const unavailable = evaluate({
      candidates: [],
      sourceChecks: [
        {
          ...availableCheck,
          status: 'timeout',
          message: 'La fuente oficial no respondio dentro del plazo.',
        },
      ],
    })

    expect(unavailable.status).toBe('source_unavailable')
    expect(unavailable.nextAction).toBe('retry_source')
  })

  it('no convierte una propuesta en seleccion automatica y desempata de forma determinista', () => {
    const second = candidate('z-candidate', 'SU', 'SUC', {
      instrumentTraceability: 'pending',
    })
    const first = candidate('a-candidate', 'SU', 'SUC', {
      instrumentTraceability: 'pending',
    })

    const result = evaluate({ candidates: [second, first] })

    expect(result.status).toBe('review_required')
    expect(result.proposal?.candidateId).toBe('a-candidate')
    expect(result.automaticSelection).toBeUndefined()
    expect(result.finalSelection).toBeUndefined()
  })
})
