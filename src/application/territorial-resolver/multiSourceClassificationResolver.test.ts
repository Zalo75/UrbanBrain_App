import { describe, expect, it, vi } from 'vitest'

import type {
  ClassificationCandidate,
  ClassificationSourcePort,
  ClassificationSourceResult,
  PlanningPort,
} from '@/domain/territorial-resolver/types'
import { MultiSourceClassificationResolver } from './multiSourceClassificationResolver'

const NOW = '2026-07-29T10:00:00.000Z'

function candidate(
  id: string,
  code: string,
  category: string,
  sourceKey: string,
  confidence: ClassificationCandidate['confidence'] = 'high'
): ClassificationCandidate {
  return {
    id,
    sourceKey,
    classification: {
      code,
      categoryCode: category,
      label: code,
      sourceFeatureIds: [id],
    },
    areas: [],
    source: 'siotuga',
    evidence: [{
      source: 'siotuga',
      sourceUrl: `https://official.test/${sourceKey}`,
      retrievedAt: NOW,
      method: 'intersección parcelaria oficial',
      scope: 'planning_classification',
    }],
    confidence,
    evidenceBasis: 'parcel_geometry',
    instrumentTraceability: 'verified',
    normalizationStatus: 'mapped',
  }
}

function sourceResult(candidateValue: ClassificationCandidate): ClassificationSourceResult {
  return {
    candidates: [candidateValue],
    discrepancies: [],
    sourceChecks: [{
      source: 'siotuga',
      status: 'available',
      checkedAt: NOW,
      message: `${candidateValue.sourceKey} disponible`,
      requiredForAutomaticDecision: true,
    }],
    officialLinks: [],
    evidence: candidateValue.evidence,
    warnings: [],
  }
}

function adapter(result: ClassificationSourceResult): ClassificationSourcePort {
  return { findClassifications: vi.fn(async () => result) }
}

const planning: PlanningPort = {
  findApplicablePlanning: vi.fn(async () => ({
    status: 'determined',
    instrument: 'PXOM vigente',
    evidence: [],
    warnings: [],
  })),
}

describe('MultiSourceClassificationResolver', () => {
  it('consulta todas las fuentes, conserva sus evidencias y elige la más fiable cuando coinciden', async () => {
    const point = candidate('point', 'SU', 'SUC', 'source-point', 'medium')
    point.evidenceBasis = 'representative_point'
    const geometry = candidate('geometry', 'SU', 'SUC', 'source-geometry')
    const pointAdapter = adapter(sourceResult(point))
    const geometryAdapter = adapter(sourceResult(geometry))
    const resolver = new MultiSourceClassificationResolver(planning, [
      { id: 'point', source: 'siotuga', adapter: pointAdapter, requiredForAutomaticDecision: true },
      { id: 'geometry', source: 'siotuga', adapter: geometryAdapter, requiredForAutomaticDecision: true },
    ])

    const result = await resolver.findApplicablePlanning({ municipalityCode: '15031' })

    expect(pointAdapter.findClassifications).toHaveBeenCalledOnce()
    expect(geometryAdapter.findClassifications).toHaveBeenCalledOnce()
    expect(result.classificationResolution?.candidates).toHaveLength(2)
    expect(result.classificationResolution?.automaticSelection).toMatchObject({
      candidateId: 'geometry',
      primarySource: 'source-geometry',
      corroboratingSources: ['source-point'],
      confidence: 'high',
    })
    expect(result.classificationResolution?.automaticSelection?.reason).toMatch(/corroborada/i)
    expect(result.classification).toMatchObject({ code: 'SU', categoryCode: 'SUC' })
  })

  it('requiere revisión cuando fuentes oficiales diferentes se contradicen', async () => {
    const resolver = new MultiSourceClassificationResolver(planning, [
      { id: 'a', source: 'siotuga', adapter: adapter(sourceResult(candidate('a', 'SU', 'SUC', 'source-a'))), requiredForAutomaticDecision: true },
      { id: 'b', source: 'siotuga', adapter: adapter(sourceResult(candidate('b', 'SR', 'SR', 'source-b'))), requiredForAutomaticDecision: true },
    ])

    const result = await resolver.findApplicablePlanning({ municipalityCode: '15031' })

    expect(result.classification).toBeUndefined()
    expect(result.classificationResolution?.status).toBe('review_required')
    expect(result.classificationResolution?.reviewReasons).toContain('source_disagreement')
    expect(result.classificationResolution?.candidates).toHaveLength(2)
  })

  it('conserva múltiples intersecciones reales de una misma fuente', async () => {
    const first = candidate('a', 'SU', 'SUC', 'same-layer')
    const second = candidate('b', 'SNR', 'SNRSC', 'same-layer')
    const resultValue = sourceResult(first)
    resultValue.candidates.push(second)
    const resolver = new MultiSourceClassificationResolver(planning, [
      { id: 'same', source: 'siotuga', adapter: adapter(resultValue), requiredForAutomaticDecision: true },
    ])

    const result = await resolver.findApplicablePlanning({ municipalityCode: '15009' })

    expect(result.classificationResolution?.status).toBe('multiple_intersections')
    expect(result.classificationResolution?.reviewReasons).not.toContain('source_disagreement')
  })

  it('conserva múltiples intersecciones cuando varias fuentes corroboran el mismo conjunto', async () => {
    const firstSource = sourceResult(candidate('a-su', 'SU', 'SUC', 'source-a'))
    firstSource.candidates.push(candidate('a-snr', 'SNR', 'SNRSC', 'source-a'))
    const secondSource = sourceResult(candidate('b-su', 'SU', 'SUC', 'source-b'))
    secondSource.candidates.push(candidate('b-snr', 'SNR', 'SNRSC', 'source-b'))
    const resolver = new MultiSourceClassificationResolver(planning, [
      { id: 'a', source: 'siotuga', adapter: adapter(firstSource), requiredForAutomaticDecision: true },
      { id: 'b', source: 'siotuga', adapter: adapter(secondSource), requiredForAutomaticDecision: true },
    ])

    const result = await resolver.findApplicablePlanning({ municipalityCode: '15009' })

    expect(result.classificationResolution?.status).toBe('multiple_intersections')
    expect(result.classificationResolution?.reviewReasons).not.toContain('source_disagreement')
    expect(result.classificationResolution?.candidates).toHaveLength(4)
  })

  it('conserva el instrumento y falla cerrado si una fuente necesaria no responde', async () => {
    const failing: ClassificationSourcePort = {
      findClassifications: vi.fn(async () => { throw new Error('offline') }),
    }
    const resolver = new MultiSourceClassificationResolver(planning, [
      { id: 'required', source: 'siotuga', adapter: failing, requiredForAutomaticDecision: true },
    ], () => new Date(NOW))

    const result = await resolver.findApplicablePlanning({ municipalityCode: '15031' })

    expect(result.instrument).toBe('PXOM vigente')
    expect(result.classification).toBeUndefined()
    expect(result.classificationResolution?.status).toBe('source_unavailable')
  })

  it('does not enable parametric answers when the PKB has no regime-to-document binding', async () => {
    const classificationOnlyPlanning: PlanningPort = {
      findApplicablePlanning: vi.fn(async () => ({
        status: 'determined',
        instrument: 'PXOM vigente',
        canAnswerConcreteParameters: false,
        evidence: [],
        warnings: [],
      })),
    }
    const resolver = new MultiSourceClassificationResolver(classificationOnlyPlanning, [
      {
        id: 'classification',
        source: 'siotuga',
        adapter: adapter(sourceResult(candidate('clear', 'SU', 'SUC', 'source-layer'))),
        requiredForAutomaticDecision: true,
      },
    ])

    const result = await resolver.findApplicablePlanning({ municipalityCode: '15031' })

    expect(result.classificationResolution?.status).toBe('clear')
    expect(result.classification).toMatchObject({ code: 'SU', categoryCode: 'SUC' })
    expect(result.canAnswerConcreteParameters).toBe(false)
  })
})
