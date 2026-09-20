import { describe, expect, it } from 'vitest'

import type {
  ManualTerritorialContext,
  TerritorialResolution,
} from '@/domain/territorial-resolver/types'
import {
  attachContinuity,
  createManualAttempt,
} from './territorialContinuity'
import { createTechnicianDetermination } from '@/domain/territorial-resolver/determinations'

function official(reference = '1234567NH4913S'): TerritorialResolution {
  return {
    status: 'confirmed',
    confidence: 'high',
    inputMethod: 'cadastral_reference',
    cadastralReference: reference,
    municipality: 'Betanzos',
    municipalityCode: '15009',
    coordinates: { lat: 43.28, lng: -8.26 },
    candidates: [],
    evidence: [
      {
        source: 'catastro',
        sourceUrl: 'https://official.test',
        retrievedAt: '2026-07-13T10:00:00.000Z',
        method: 'fixture',
      },
    ],
    warnings: [],
    conflicts: [],
    sourceChecks: [
      {
        source: 'catastro',
        status: 'available',
        checkedAt: '2026-07-13T10:00:00.000Z',
        message: 'Catastro respondio correctamente.',
      },
    ],
    planning: {
      status: 'partial',
      instrument: 'Normas Subsidiarias',
      canAnswerConcreteParameters: false,
      evidence: [],
      warnings: [],
    },
    affects: {
      analysisGeometry: 'parcel',
      detected: [],
      canRuleOutUndetectedAffects: false,
      warnings: [],
    },
    resolvedAt: '2026-07-13T10:00:00.000Z',
  }
}

function clearOfficial(reference = '1234567NH4913S'): TerritorialResolution {
  const base = official(reference)
  const intersectionGeometry = {
    type: 'MultiPolygon' as const,
    crs: 'EPSG:4326' as const,
    coordinates: [[[[-8.2, 43.2], [-8.19, 43.2], [-8.2, 43.21], [-8.2, 43.2]]]],
  }
  return {
    ...base,
    planning: {
      status: 'determined',
      instrument: 'PXOM',
      classification: {
        code: 'SNR',
        categoryCode: 'SNRC',
        label: 'Suelo de núcleo rural',
        categoryLabel: 'Núcleo rural común',
        sourceFeatureIds: ['candidate-snr'],
      },
      classificationResolution: {
        status: 'clear',
        confidenceLevel: 'confirmed',
        nextAction: 'auto_accept',
        candidates: [{
          kind: 'official_classification',
          id: 'candidate-snr',
          classification: {
            code: 'SNR',
            categoryCode: 'SNRC',
            label: 'Suelo de núcleo rural',
            categoryLabel: 'Núcleo rural común',
            sourceFeatureIds: ['candidate-snr'],
          },
          areas: [],
          source: 'siotuga',
          evidence: [],
          confidence: 'high',
          evidenceBasis: 'parcel_geometry',
          instrumentTraceability: 'verified',
          normalizationStatus: 'mapped',
          parcelCoverage: {
            parcelAreaSquareMetres: 1000,
            intersectionAreaSquareMetres: 1000,
            parcelPercentage: 100,
            method: 'polygon_intersection',
            intersectionGeometry,
          },
        }],
        discrepancies: [],
        reviewReasons: [],
        automaticSelection: {
          origin: 'automatic',
          candidateId: 'candidate-snr',
          classificationCode: 'SNR',
          categoryCode: 'SNRC',
          areaNames: [],
          technicianValidated: false,
        },
        sourceChecks: [],
        officialLinks: [],
        evidence: [],
      },
      canAnswerConcreteParameters: true,
      evidence: [],
      warnings: [],
    },
  }
}

function automaticDetectedZoneManualContext(): ManualTerritorialContext {
  return {
    provenance: 'manual',
    verification: 'unverified',
    recordedAt: '2026-08-10T12:00:00.000Z',
    actionAreaSelection: {
      history: [],
      current: {
        id: 'selection-snr',
        selectionType: 'detected_zone',
        selectedCandidateId: 'candidate-snr',
        geometry: {
          type: 'MultiPolygon',
          crs: 'EPSG:4326',
          coordinates: [[[[-8.2, 43.2], [-8.19, 43.2], [-8.2, 43.21], [-8.2, 43.2]]]],
        },
        surfaceSquareMetres: 1000,
        parcelSurfaceSquareMetres: 1000,
        classification: 'SNR',
        category: 'SNRC',
        planningZone: 'Núcleo rural común',
        planningZones: ['Núcleo rural común'],
        source: 'siotuga',
        confidence: 'high',
        selectedBy: 'architect-a',
        selectedAt: '2026-08-10T12:00:00.000Z',
        verification: 'unverified',
      },
    },
  }
}

function failed(status: 'timeout' | 'unavailable' | 'malformed'): TerritorialResolution {
  return {
    status: 'unresolved',
    confidence: 'low',
    inputMethod: 'cadastral_reference',
    candidates: [],
    evidence: [],
    warnings: [],
    conflicts: [],
    sourceChecks: [
      {
        source: 'catastro',
        status,
        checkedAt: '2026-07-14T10:00:00.000Z',
        message: 'Comprobacion pendiente.',
      },
    ],
    planning: { status: 'not_determined', evidence: [], warnings: [] },
    affects: {
      analysisGeometry: 'none',
      detected: [],
      canRuleOutUndetectedAffects: false,
      warnings: [],
    },
    resolvedAt: '2026-07-14T10:00:00.000Z',
  }
}

describe('territorial continuity', () => {
  it.each(['timeout', 'unavailable', 'malformed'] as const)(
    'preserva el ultimo contexto oficial para la misma parcela tras %s',
    (status) => {
      const result = attachContinuity(
        failed(status),
        { cadastralReference: '1234567NH4913S' },
        official()
      )

      expect(result.continuity).toMatchObject({
        usingPreviousOfficialContext: true,
        sameParcelAsPrevious: true,
      })
      expect(result.continuity?.effectiveOfficialContext?.resolvedAt).toBe(
        '2026-07-13T10:00:00.000Z'
      )
    }
  )

  it('no hereda el contexto oficial si la referencia catastral es diferente', () => {
    const result = attachContinuity(
      failed('timeout'),
      { cadastralReference: '9999999NH4999S' },
      official('1234567NH4913S')
    )

    expect(result.continuity?.usingPreviousOfficialContext).toBe(false)
    expect(result.continuity?.effectiveOfficialContext).toBeUndefined()
    expect(result.continuity?.lastOfficialContext).toBeDefined()
  })

  it('conserva el contexto oficial si coinciden las coordenadas (mismo par completo) aunque falte referencia', () => {
    const result = attachContinuity(
      failed('timeout'),
      { coordinates: { lat: 43.28, lng: -8.26 } },
      official() // official() tiene lat: 43.28, lng: -8.26
    )

    expect(result.continuity?.usingPreviousOfficialContext).toBe(true)
    expect(result.continuity?.sameParcelAsPrevious).toBe(true)
  })

  it('no hereda el contexto oficial si las coordenadas son de una parcela distinta', () => {
    const result = attachContinuity(
      failed('timeout'),
      { coordinates: { lat: 43.1, lng: -8.1 } }, // Distinto a 43.28, -8.26
      official()
    )

    expect(result.continuity?.usingPreviousOfficialContext).toBe(false)
    expect(result.continuity?.sameParcelAsPrevious).toBe(false)
  })

  it('un reintento exitoso vuelve a usar el contexto oficial actual', () => {
    const priorFailure = attachContinuity(
      failed('timeout'),
      { cadastralReference: '1234567NH4913S' },
      official()
    )
    const retried = attachContinuity(
      { ...official(), resolvedAt: '2026-07-14T11:00:00.000Z' },
      { cadastralReference: '1234567NH4913S' },
      priorFailure
    )

    expect(retried.continuity?.usingPreviousOfficialContext).toBe(false)
    expect(retried.continuity?.effectiveOfficialContext).toBeUndefined()
    expect(retried.resolvedAt).toBe('2026-07-14T11:00:00.000Z')
  })

  it('does not inherit an exact automatic detected zone as unverified manual context on recalculation', () => {
    const previous = clearOfficial()
    previous.continuity = {
      usingPreviousOfficialContext: false,
      sameParcelAsPrevious: true,
      manualContext: automaticDetectedZoneManualContext(),
    }

    const recalculated = attachContinuity(
      { ...clearOfficial(), resolvedAt: '2026-08-11T11:00:00.000Z' },
      { cadastralReference: '1234567NH4913S' },
      previous
    )

    expect(recalculated.continuity?.manualContext).toBeUndefined()
    expect(recalculated.planning.classificationResolution?.status).toBe('clear')
    expect(recalculated.planning.canAnswerConcreteParameters).toBe(true)
  })

  it.each([
    {
      name: 'the selected candidate differs',
      alter: (current: TerritorialResolution, manual: ManualTerritorialContext) => {
        manual.actionAreaSelection!.current!.selectedCandidateId = 'other-candidate'
        return current
      },
    },
    {
      name: 'the recalculated resolution requires review',
      alter: (current: TerritorialResolution) => {
        current.planning.classificationResolution!.status = 'review_required'
        current.planning.classificationResolution!.nextAction = 'review_official_sources'
        return current
      },
    },
    {
      name: 'the current planning source check is only partial',
      alter: (current: TerritorialResolution) => {
        current.planning.sourceChecks = [{
          source: 'siotuga',
          status: 'partial',
          checkedAt: '2026-08-11T11:00:00.000Z',
          message: 'El recálculo no completó la comprobación del planeamiento.',
        }]
        return current
      },
    },
    {
      name: 'another manual determination remains active',
      alter: (current: TerritorialResolution, manual: ManualTerritorialContext) => {
        manual.classification = 'rustico_no_urbanizable'
        return current
      },
    },
  ])('keeps inherited technical review when $name', ({ alter }) => {
    const previous = clearOfficial()
    const manual = automaticDetectedZoneManualContext()
    previous.continuity = {
      usingPreviousOfficialContext: false,
      sameParcelAsPrevious: true,
      manualContext: manual,
    }
    const current = alter(clearOfficial(), manual)

    const recalculated = attachContinuity(
      current,
      { cadastralReference: '1234567NH4913S' },
      previous
    )

    expect(recalculated.continuity?.manualContext).toBe(manual)
  })

  it('conserva afecciones positivas previas si IDEG falla pero Catastro funciona', () => {
    const previous = official()
    previous.affects.detected = [
      {
        category: 'patrimonio',
        name: 'Entorno protegido',
        attributes: {},
        confidence: 'high',
        evidence: {
          source: 'ideg',
          sourceUrl: 'https://official.test/ideg',
          retrievedAt: previous.resolvedAt,
          method: 'fixture',
        },
      },
    ]
    const current = {
      ...official(),
      resolvedAt: '2026-07-14T10:00:00.000Z',
      affects: {
        analysisGeometry: 'parcel' as const,
        detected: [],
        canRuleOutUndetectedAffects: false as const,
        warnings: [],
        sourceChecks: [
          {
            source: 'ideg' as const,
            status: 'unavailable' as const,
            checkedAt: '2026-07-14T10:00:00.000Z',
            message: 'IDEG no responde.',
          },
        ],
      },
    }

    const result = attachContinuity(
      current,
      { cadastralReference: '1234567NH4913S' },
      previous
    )

    expect(result.continuity?.usingPreviousOfficialContext).toBe(true)
    expect(result.continuity?.effectiveOfficialContext?.affects.detected[0].name).toBe(
      'Entorno protegido'
    )
    expect(result.continuity?.effectiveOfficialContext?.resolvedAt).toBe(previous.resolvedAt)
  })

  it.each(['unverified', 'technician_validated'] as const)(
    'conserva procedencia y estado manual %s',
    (verification) => {
      const manual: ManualTerritorialContext = {
        municipality: 'Betanzos',
        classification: 'Suelo urbano',
        provenance: 'manual',
        verification,
        recordedAt: '2026-07-14T12:00:00.000Z',
      }
      const result = createManualAttempt(
        { cadastralReference: '1234567NH4913S' },
        manual,
        official()
      )

      expect(result.continuity?.manualContext).toEqual(manual)
      expect(result.continuity?.usingPreviousOfficialContext).toBe(true)
      expect(result.planning.canAnswerConcreteParameters).toBe(false)
    }
  )

  it('preserves a confirmed ordinance when a later automatic recalculation succeeds', () => {
    const previous = official()
    const manual: ManualTerritorialContext = {
      municipality: 'Betanzos',
      ordinance: 'R-2',
      ordinanceDetermination: {
        technician: createTechnicianDetermination('R-2', 'architect-a', undefined, {
          now: () => new Date('2026-07-14T12:00:00.000Z'),
        }),
      },
      provenance: 'manual',
      verification: 'technician_validated',
      recordedAt: '2026-07-14T12:00:00.000Z',
    }
    previous.continuity = {
      usingPreviousOfficialContext: false,
      sameParcelAsPrevious: true,
      manualContext: manual,
    }
    const current = clearOfficial()
    const recalculated = attachContinuity(
      current,
      { cadastralReference: '1234567NH4913S' },
      previous,
    )

    expect(recalculated.continuity?.manualContext?.ordinanceDetermination?.technician?.value).toBe('R-2')
    expect(recalculated.continuity?.manualContext?.ordinanceDetermination?.technician?.origin).toBe('technician_selection')
  })

  it('preserves prior detailed candidates when a recalculation only degrades their semantic labels', () => {
    const previous = clearOfficial()
    previous.planning.ordinanceCandidates = [{
      identity: 'R-2',
      instrumentId: 'PXOM',
      semanticDimension: 'ordinance',
      normalizedIdentity: 'R-2',
      sourceRef: 'official:previous-sheet',
      provenance: ['official:previous-sheet'],
      instrumentMembership: true,
      confidence: 'high',
      status: 'active',
    }]
    previous.planning.ordinanceResolutionStatus = 'automatically_determined'

    const current = clearOfficial()
    current.planning.classification = {
      code: 'SU',
      categoryCode: 'SU-C',
      label: 'Suelo urbano',
      categoryLabel: 'Suelo urbano consolidado',
      sourceFeatureIds: ['official:classification'],
    }
    current.planning.ordinanceCandidates = []
    current.planning.contextualCandidates = [
      { ...previous.planning.ordinanceCandidates[0]!, semanticDimension: 'category' },
      { ...previous.planning.ordinanceCandidates[0]!, identity: 'SU-C', normalizedIdentity: 'SU-C', semanticDimension: 'category' },
    ]
    current.planning.ordinanceResolutionStatus = 'manual_confirmation_required'

    const recalculated = attachContinuity(
      current,
      { cadastralReference: '1234567NH4913S' },
      previous,
    )

    expect(recalculated.planning.ordinanceCandidates?.map((candidate) => candidate.identity)).toEqual(['R-2'])
    expect(recalculated.planning.ordinanceResolutionStatus).toBe('automatically_determined')
  })

  it('does not carry detailed candidates across a changed planning instrument', () => {
    const previous = clearOfficial()
    previous.planning.applicableInstruments = [{
      id: 'instrument-before',
      name: 'Previous plan',
      kind: 'general',
      status: 'current',
      sourceUrl: 'official:previous-plan',
    }]
    previous.planning.ordinanceCandidates = [{
      identity: 'R-2',
      instrumentId: 'instrument-before',
      semanticDimension: 'ordinance',
      provenance: ['official:previous-sheet'],
      status: 'active',
    }]

    const current = clearOfficial()
    current.planning.applicableInstruments = [{
      id: 'instrument-after',
      name: 'Current plan',
      kind: 'general',
      status: 'current',
      sourceUrl: 'official:current-plan',
    }]
    current.planning.classification = {
      code: 'SU',
      categoryCode: 'SU-C',
      label: 'Suelo urbano',
      categoryLabel: 'Suelo urbano consolidado',
      sourceFeatureIds: ['official:classification'],
    }
    current.planning.ordinanceCandidates = []
    current.planning.contextualCandidates = [{
      identity: 'R-2',
      instrumentId: 'instrument-after',
      semanticDimension: 'category',
      provenance: ['official:current-sheet'],
      status: 'active',
    }]

    const recalculated = attachContinuity(
      current,
      { cadastralReference: '1234567NH4913S' },
      previous,
    )

    expect(recalculated.planning.ordinanceCandidates).toEqual([])
  })

  it('preserves prior planning evidence when a zoning source fails transiently', () => {
    const previous = clearOfficial()
    previous.planning.applicableInstruments = [{
      id: 'instrument-teo',
      name: 'Plan oficial',
      kind: 'general',
      status: 'current',
      sourceUrl: 'official:plan',
    }]
    previous.planning.ordinanceCandidates = [{
      identity: 'R-2',
      instrumentId: 'instrument-teo',
      semanticDimension: 'ordinance',
      provenance: ['official:previous-zoning'],
      confidence: 'high',
      status: 'active',
    }]
    previous.planning.contextualCandidates = [{
      identity: 'SU-C',
      instrumentId: 'instrument-teo',
      semanticDimension: 'category',
      provenance: ['official:previous-classification'],
      confidence: 'medium',
      status: 'active',
    }]

    const current = clearOfficial()
    current.planning.applicableInstruments = previous.planning.applicableInstruments
    current.planning.ordinanceCandidates = []
    current.planning.contextualCandidates = []
    current.planning.sourceChecks = [{
      source: 'siotuga',
      status: 'unavailable',
      checkedAt: '2026-08-27T10:00:00.000Z',
      message: 'fetch failed',
    }]

    const recalculated = attachContinuity(
      current,
      { cadastralReference: '1234567NH4913S' },
      previous,
    )

    expect(recalculated.planning.ordinanceCandidates?.map((candidate) => candidate.identity)).toEqual(['R-2'])
    expect(recalculated.planning.contextualCandidates?.map((candidate) => candidate.identity)).toEqual(['SU-C'])
    expect(recalculated.planning.status).toBe('partial')
    expect(recalculated.planning.sourceChecks).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'siotuga', status: 'unavailable' }),
    ]))
    expect(recalculated.continuity?.usingPreviousOfficialContext).toBe(true)
  })

  it('keeps a prior USER_CONFIRMED determination through a transient failure', () => {
    const previous = clearOfficial()
    previous.planning.applicableInstruments = [{
      id: 'instrument-teo',
      name: 'Plan oficial',
      kind: 'general',
      status: 'current',
      sourceUrl: 'official:plan',
    }]
    previous.planning.ordinanceCandidates = [{
      identity: 'R-2',
      instrumentId: 'instrument-teo',
      semanticDimension: 'ordinance',
      provenance: ['official:previous-zoning'],
      confidence: 'high',
      status: 'user_confirmed',
    }]
    previous.planning.ordinanceResolution = {
      status: 'USER_CONFIRMED',
      identity: { code: 'R-2', label: 'R-2' },
      confidence: 'high',
      provenance: ['technician:architect-a'],
      confirmationSource: 'user',
      confirmedByUser: true,
    }

    const current = clearOfficial()
    current.planning.applicableInstruments = previous.planning.applicableInstruments
    current.planning.ordinanceCandidates = []
    current.planning.sourceChecks = [{
      source: 'siotuga',
      status: 'timeout',
      checkedAt: '2026-08-27T10:00:00.000Z',
      message: 'timeout',
    }]

    const recalculated = attachContinuity(
      current,
      { cadastralReference: '1234567NH4913S' },
      previous,
    )

    expect(recalculated.planning.ordinanceResolution).toMatchObject({
      status: 'USER_CONFIRMED',
      confirmedByUser: true,
      identity: { code: 'R-2' },
    })
    expect(recalculated.planning.ordinanceCandidates?.[0]?.status).toBe('user_confirmed')
  })

  it('does not inherit planning evidence when the instrument changes', () => {
    const previous = clearOfficial()
    previous.planning.applicableInstruments = [{
      id: 'instrument-before',
      name: 'Previous plan',
      kind: 'general',
      status: 'current',
      sourceUrl: 'official:previous-plan',
    }]
    previous.planning.ordinanceCandidates = [{
      identity: 'R-2',
      instrumentId: 'instrument-before',
      semanticDimension: 'ordinance',
      provenance: ['official:previous-zoning'],
    }]

    const current = clearOfficial()
    current.planning.applicableInstruments = [{
      id: 'instrument-after',
      name: 'Current plan',
      kind: 'general',
      status: 'current',
      sourceUrl: 'official:current-plan',
    }]
    current.planning.ordinanceCandidates = []
    current.planning.sourceChecks = [{
      source: 'siotuga',
      status: 'unavailable',
      checkedAt: '2026-08-27T10:00:00.000Z',
      message: 'fetch failed',
    }]

    const recalculated = attachContinuity(
      current,
      { cadastralReference: '1234567NH4913S' },
      previous,
    )

    expect(recalculated.planning.ordinanceCandidates).toEqual([])
    expect(recalculated.continuity?.usingPreviousOfficialContext).toBe(false)
  })

  it('does not inherit planning evidence when the municipality changes', () => {
    const previous = clearOfficial()
    previous.planning.ordinanceCandidates = [{
      identity: 'R-2',
      instrumentId: 'PXOM',
      semanticDimension: 'ordinance',
      provenance: ['official:previous-zoning'],
    }]
    const current = clearOfficial()
    current.municipality = 'Another municipality'
    current.municipalityCode = '15999'
    current.planning.ordinanceCandidates = []
    current.planning.sourceChecks = [{
      source: 'siotuga',
      status: 'unavailable',
      checkedAt: '2026-08-27T10:00:00.000Z',
      message: 'fetch failed',
    }]

    const recalculated = attachContinuity(
      current,
      { cadastralReference: '1234567NH4913S' },
      previous,
    )

    expect(recalculated.planning.ordinanceCandidates).toEqual([])
    expect(recalculated.continuity?.usingPreviousOfficialContext).toBe(false)
  })

  it('keeps a new valid result ahead of the previous result', () => {
    const previous = clearOfficial()
    previous.planning.ordinanceCandidates = [{
      identity: 'R-2',
      instrumentId: 'PXOM',
      semanticDimension: 'ordinance',
      provenance: ['official:previous-zoning'],
    }]
    const current = clearOfficial()
    current.planning.ordinanceCandidates = [{
      identity: 'R-3',
      instrumentId: 'PXOM',
      semanticDimension: 'ordinance',
      provenance: ['official:current-zoning'],
    }]
    current.planning.sourceChecks = [{
      source: 'siotuga',
      status: 'unavailable',
      checkedAt: '2026-08-27T10:00:00.000Z',
      message: 'auxiliary source unavailable',
    }]

    const recalculated = attachContinuity(
      current,
      { cadastralReference: '1234567NH4913S' },
      previous,
    )

    expect(recalculated.planning.ordinanceCandidates?.map((candidate) => candidate.identity)).toEqual(['R-3'])
  })

  it('does not treat a legitimate empty result as a transient failure', () => {
    const previous = clearOfficial()
    previous.planning.ordinanceCandidates = [{
      identity: 'R-2',
      instrumentId: 'PXOM',
      semanticDimension: 'ordinance',
      provenance: ['official:previous-zoning'],
    }]
    const current = clearOfficial()
    current.planning.ordinanceCandidates = []
    current.planning.contextualCandidates = []
    current.planning.sourceChecks = []

    const recalculated = attachContinuity(
      current,
      { cadastralReference: '1234567NH4913S' },
      previous,
    )

    expect(recalculated.planning.ordinanceCandidates).toEqual([])
    expect(recalculated.continuity?.usingPreviousOfficialContext).toBe(false)
  })
})
