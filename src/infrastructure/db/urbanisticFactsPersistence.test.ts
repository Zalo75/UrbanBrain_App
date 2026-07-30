import { describe, expect, it, vi } from 'vitest'

vi.mock('@/infrastructure/db/client', () => ({ db: {} }))

import { buildNormalizedParcelContext } from '@/application/parcel-context/normalizeParcelContext'
import { buildTerritorialContextView } from '@/application/territorial-resolver/territorialContextView'
import { urbanisticFactsFromRaw } from './parcelContextRepository'
import type {
  ClassificationResolution,
  TerritorialResolution,
  UrbanisticRegimeFacts,
} from '@/domain/territorial-resolver/types'

const NOW = '2026-07-30T12:00:00.000Z'

function classificationResolution(
  overrides: Partial<ClassificationResolution> = {}
): ClassificationResolution {
  return {
    status: 'clear',
    confidenceLevel: 'confirmed',
    nextAction: 'auto_accept',
    candidates: [
      {
        id: 'siotuga:su',
        classification: {
          code: 'SU',
          label: 'Suelo urbano',
          categoryCode: 'SUC',
          categoryLabel: 'Suelo urbano consolidado',
          sourceFeatureIds: ['feature-1'],
        },
        areas: [],
        source: 'siotuga',
        evidence: [],
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

function result(
  resolution?: ClassificationResolution,
  facts?: UrbanisticRegimeFacts
): TerritorialResolution {
  return {
    status: 'confirmed',
    confidence: 'high',
    inputMethod: 'cadastral_reference',
    municipality: 'Betanzos',
    municipalityCode: '15009',
    candidates: [],
    evidence: [
      {
        source: 'catastro',
        sourceUrl: 'https://official.test/catastro',
        retrievedAt: NOW,
        method: 'fixture',
      },
    ],
    warnings: [],
    conflicts: [],
    planning: {
      status: 'determined',
      instrument: 'PXOM vigente',
      classificationResolution: resolution,
      urbanisticFacts: facts,
      evidence: [],
      warnings: [],
    },
    affects: {
      analysisGeometry: 'parcel',
      detected: [],
      canRuleOutUndetectedAffects: false,
      warnings: [],
    },
    resolvedAt: NOW,
  }
}

describe('urbanisticFacts persistence compatibility', () => {
  it('preserva hechos V2 exactos en lectura, normalizacion y reconstruccion', () => {
    const stored: UrbanisticRegimeFacts = {
      classification: {
        value: { code: 'SU', label: 'Suelo urbano' },
        status: 'automatic_confirmed',
        confidence: 'high',
        evidence: [],
        warnings: [],
        discrepancies: [],
        nextAction: 'none',
      },
      category: {
        value: { code: 'SUC', label: 'Suelo urbano consolidado' },
        status: 'automatic_confirmed',
        confidence: 'high',
        evidence: [],
        warnings: [],
        discrepancies: [],
        nextAction: 'none',
      },
      consolidation: {
        status: 'manual_review_required',
        confidence: 'high',
        evidence: [],
        warnings: ['La consolidacion requiere revision.'],
        discrepancies: [],
        nextAction: 'review_official_sources',
      },
    }
    const raw = result(classificationResolution(), stored)

    expect(urbanisticFactsFromRaw(raw)).toBe(stored)
    expect(buildNormalizedParcelContext({ expediente: {}, detected: { urbanisticFacts: stored } }))
      .toMatchObject({ urbanisticFacts: stored })
    expect(buildTerritorialContextView(raw)?.urbanisticFacts).toBe(stored)
  })

  it('deriva en lectura hechos de un JSON historico sin reescribir los campos legacy', () => {
    const legacy = result(classificationResolution())

    const facts = urbanisticFactsFromRaw(legacy)

    expect(legacy.planning.urbanisticFacts).toBeUndefined()
    expect(legacy.planning.classificationResolution).toBeDefined()
    expect(facts).toMatchObject({
      classification: { status: 'automatic_confirmed', value: { code: 'SU' } },
      category: { status: 'automatic_confirmed', value: { code: 'SUC' } },
      consolidation: { status: 'manual_review_required' },
    })
    expect(buildTerritorialContextView(legacy)?.urbanisticFacts).toMatchObject({
      classification: { status: 'automatic_confirmed' },
    })
  })

  it('no inventa hechos cuando el JSON historico no tiene resolucion suficiente', () => {
    const historical = result()

    expect(urbanisticFactsFromRaw(historical)).toBeUndefined()
    expect(buildNormalizedParcelContext({ expediente: {} }).urbanisticFacts).toBeUndefined()
  })

  it('reconstruye conflictos y ausencia de capa sin elegir candidatos', () => {
    const multiple = classificationResolution({
      status: 'multiple_intersections',
      confidenceLevel: 'unknown',
      nextAction: 'manual_selection',
      automaticSelection: undefined,
      candidates: [
        classificationResolution().candidates[0]!,
        {
          ...classificationResolution().candidates[0]!,
          id: 'siotuga:snr',
          classification: {
            ...classificationResolution().candidates[0]!.classification,
            code: 'SNR',
            label: 'Suelo de nucleo rural',
          },
        },
      ],
    })
    const unavailable = classificationResolution({
      status: 'not_available',
      confidenceLevel: 'unknown',
      nextAction: 'manual_selection',
      candidates: [],
      automaticSelection: undefined,
    })

    expect(urbanisticFactsFromRaw(result(multiple))).toMatchObject({
      classification: { status: 'conflict', value: undefined },
      category: { status: 'conflict', value: undefined },
      consolidation: { status: 'conflict', value: undefined },
    })
    expect(urbanisticFactsFromRaw(result(unavailable))).toMatchObject({
      classification: { status: 'not_available' },
      category: { status: 'not_available' },
      consolidation: { status: 'not_available' },
    })
  })

  it('conserva los hechos automaticos cuando existe contexto manual independiente', () => {
    const automatic = urbanisticFactsFromRaw(result(classificationResolution()))!
    const raw = {
      ...result(classificationResolution(), automatic),
      continuity: {
        usingPreviousOfficialContext: false,
        sameParcelAsPrevious: true,
        manualContext: {
          classification: 'Suelo rustico',
          provenance: 'manual' as const,
          verification: 'technician_validated' as const,
          recordedAt: NOW,
        },
      },
    }

    expect(buildTerritorialContextView(raw)?.urbanisticFacts).toBe(automatic)
    expect(
      buildNormalizedParcelContext({
        expediente: {},
        detected: {
          urbanisticFacts: automatic,
          manualContext: raw.continuity.manualContext,
        },
      }).urbanisticFacts
    ).toBe(automatic)
  })
})
