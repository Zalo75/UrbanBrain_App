import { describe, expect, it } from 'vitest'

import type { ClassificationResolution, PlanningApplicability } from './types'
import {
  urbanisticFactsFromClassificationResolution,
  withUrbanisticFacts,
} from './urbanisticFacts'

const NOW = '2026-07-30T12:00:00.000Z'

function resolution(overrides: Partial<ClassificationResolution> = {}): ClassificationResolution {
  return {
    status: 'clear',
    confidenceLevel: 'confirmed',
    nextAction: 'auto_accept',
    candidates: [
      {
        kind: 'official_classification' as const,
        id: 'siotuga:su',
        classification: {
          code: 'SU',
          categoryCode: 'SUC',
          label: 'Suelo urbano',
          categoryLabel: 'Suelo urbano consolidado',
          sourceFeatureIds: ['feature-1'],
        },
        areas: [],
        source: 'siotuga',
        evidence: [
          {
            source: 'siotuga',
            sourceUrl: 'https://official.test/layer',
            retrievedAt: NOW,
            method: 'WFS oficial',
            scope: 'planning_classification',
          },
        ],
        confidence: 'high',
        evidenceBasis: 'parcel_geometry',
        instrumentTraceability: 'verified',
        normalizationStatus: 'mapped',
      },
    ],
    discrepancies: [],
    reviewReasons: [],
    automaticSelection: {
      origin: 'automatic',
      candidateId: 'siotuga:su',
      classificationCode: 'SU',
      categoryCode: 'SUC',
      areaNames: [],
      technicianValidated: false,
    },
    sourceChecks: [],
    officialLinks: [],
    evidence: [],
    ...overrides,
  }
}

function planning(classificationResolution?: ClassificationResolution): PlanningApplicability {
  return {
    status: 'determined',
    instrument: 'PXOM vigente',
    applicableInstruments: [
      {
        id: 'pxom-1',
        name: 'PXOM vigente',
        kind: 'general',
        status: 'current',
        sourceUrl: 'https://official.test/instrument',
      },
    ],
    classificationResolution,
    evidence: [],
    warnings: [],
  }
}

describe('urbanisticFactsFromClassificationResolution', () => {
  it('conserva la clasificación confirmada cuando la categoría no está disponible', () => {
    const legacy = resolution({
      candidates: [
        {
          ...resolution().candidates[0],
          classification: {
            ...resolution().candidates[0]!.classification,
            categoryCode: undefined,
            categoryLabel: undefined,
          },
        },
      ],
      automaticSelection: {
        ...resolution().automaticSelection!,
        categoryCode: undefined,
      },
    })

    const facts = urbanisticFactsFromClassificationResolution(planning(legacy), NOW)

    expect(facts.classification).toMatchObject({
      value: { code: 'SU', label: 'Suelo urbano' },
      status: 'automatic_confirmed',
    })
    expect(facts.category).toMatchObject({
      value: undefined,
      status: 'manual_review_required',
    })
    expect(facts.category.warnings.join(' ')).toMatch(/categoría del suelo/i)
    expect(facts.consolidation.status).toBe('manual_review_required')
    expect(facts.consolidation.warnings.join(' ')).toMatch(/consolidado/i)
  })

  it('mantiene instrumento y marca hechos pendientes cuando el municipio no tiene capas', () => {
    const legacy = resolution({
      status: 'not_available',
      confidenceLevel: 'unknown',
      nextAction: 'manual_selection',
      candidates: [],
      automaticSelection: undefined,
    })
    const facts = urbanisticFactsFromClassificationResolution(planning(legacy), NOW)

    expect(facts.classification.status).toBe('not_available')
    expect(facts.category.status).toBe('not_available')
    expect(facts.consolidation.status).toBe('not_available')
    expect(facts.classification.instrumentId).toBe('pxom-1')
  })

  it('conserva la resolución legacy de Betanzos sin seleccionar una clasificación mixta', () => {
    const legacy = resolution({
      status: 'multiple_intersections',
      confidenceLevel: 'unknown',
      nextAction: 'manual_selection',
      automaticSelection: undefined,
      candidates: [
        resolution().candidates[0]!,
        {
          ...resolution().candidates[0]!,
          id: 'siotuga:snr',
          classification: {
            ...resolution().candidates[0]!.classification,
            code: 'SNR',
            label: 'Suelo de núcleo rural',
          },
        },
      ],
    })
    const source = planning(legacy)
    const compatible = withUrbanisticFacts(source, NOW)

    expect(compatible.classificationResolution).toBe(legacy)
    expect(compatible.urbanisticFacts?.classification.status).toBe('conflict')
    expect(compatible.urbanisticFacts?.category.status).toBe('conflict')
    expect(compatible.urbanisticFacts?.consolidation.status).toBe('conflict')
    expect(compatible.classification).toBeUndefined()
  })

  it('preserva intacto el contrato legacy al añadir los hechos V2', () => {
    const legacy = resolution()
    const source = planning(legacy)
    const compatible = withUrbanisticFacts(source, NOW)

    expect(compatible.classificationResolution).toBe(legacy)
    expect(compatible.urbanisticFacts?.classification.value?.code).toBe('SU')
    expect(source.urbanisticFacts).toBeUndefined()
  })
})
