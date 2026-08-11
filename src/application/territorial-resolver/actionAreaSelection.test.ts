import { describe, expect, it } from 'vitest'

import type {
  ClassificationCandidate,
  ClassificationResolution,
  ParcelGeometry,
  TerritorialResolution,
  UrbanisticRegimeFacts,
} from '@/domain/territorial-resolver/types'
import {
  applyActionAreaToUrbanisticFacts,
  createDetectedZoneActionArea,
  createWholeParcelActionArea,
  matchesClearAutomaticDetectedZone,
  revokeActionAreaSelection,
} from './actionAreaSelection'

const geometry: ParcelGeometry = {
  type: 'MultiPolygon',
  crs: 'EPSG:4326',
  coordinates: [[[[-8.2, 43.2], [-8.19, 43.2], [-8.2, 43.21], [-8.2, 43.2]]]],
}

function candidate(id: string, code: string, categoryCode: string, area: string): ClassificationCandidate {
  return {
    kind: 'official_classification' as const,
    id,
    classification: {
      code,
      categoryCode,
      label: code,
      categoryLabel: categoryCode,
      sourceFeatureIds: [id],
    },
    areas: [{ type: 'zone', name: area, sourceFeatureIds: [id] }],
    source: 'siotuga',
    evidence: [{
      source: 'siotuga',
      sourceUrl: 'https://official.test/wfs',
      retrievedAt: '2026-08-04T10:00:00.000Z',
      method: 'polygon_intersection',
    }],
    confidence: 'high',
    evidenceBasis: 'parcel_geometry',
    instrumentTraceability: 'verified',
    normalizationStatus: 'mapped',
    parcelCoverage: {
      parcelAreaSquareMetres: 8260,
      intersectionAreaSquareMetres: 1828.24,
      parcelPercentage: 22.16,
      method: 'polygon_intersection',
      intersectionGeometry: geometry,
    },
  }
}

function automaticFacts(): UrbanisticRegimeFacts {
  return {
    classification: {
      value: { code: 'SR', label: 'Suelo rústico' },
      label: 'Suelo rústico',
      status: 'automatic_confirmed',
      origin: 'spatial_intersection',
      confidence: 'high',
      evidence: [],
      warnings: [],
      discrepancies: [],
      nextAction: 'none',
    },
    category: {
      value: { code: 'SRP', label: 'Suelo rústico protegido' },
      label: 'Suelo rústico protegido',
      status: 'automatic_confirmed',
      origin: 'spatial_intersection',
      confidence: 'high',
      evidence: [],
      warnings: [],
      discrepancies: [],
      nextAction: 'none',
    },
    consolidation: {
      status: 'not_applicable',
      confidence: 'unknown',
      evidence: [],
      warnings: [],
      discrepancies: [],
      nextAction: 'none',
    },
  }
}

function clearResolution(
  selected: ClassificationCandidate,
  overrides: Partial<ClassificationResolution> = {}
): TerritorialResolution {
  if (selected.kind !== 'official_classification') {
    throw new Error('The clear fixture requires an official candidate.')
  }
  const classificationResolution: ClassificationResolution = {
    status: 'clear',
    confidenceLevel: 'confirmed',
    nextAction: 'auto_accept',
    candidates: [selected],
    discrepancies: [],
    reviewReasons: [],
    automaticSelection: {
      origin: 'automatic',
      candidateId: selected.id,
      classificationCode: selected.classification.code,
      categoryCode: selected.classification.categoryCode,
      areaNames: selected.areas.map((area) => area.name),
      technicianValidated: false,
    },
    sourceChecks: [],
    officialLinks: [],
    evidence: [],
    ...overrides,
  }
  return {
    status: 'confirmed',
    confidence: 'high',
    inputMethod: 'cadastral_reference',
    cadastralReference: '1234567NH4913S',
    candidates: [],
    evidence: [],
    warnings: [],
    conflicts: [],
    planning: {
      status: 'determined',
      classification: selected.classification,
      classificationResolution,
      canAnswerConcreteParameters: true,
      evidence: [],
      warnings: [],
    },
    affects: {
      analysisGeometry: 'parcel',
      detected: [],
      canRuleOutUndetectedAffects: false,
      warnings: [],
    },
    resolvedAt: '2026-08-11T10:00:00.000Z',
  }
}

describe('action area selection', () => {
  it('permite mantener toda la parcela como área sin crear una geometría alternativa', () => {
    const selection = createWholeParcelActionArea({
      geometry,
      surfaceSquareMetres: 8260,
      selectedBy: 'architect-a',
      selectedAt: '2026-08-04T09:00:00.000Z',
      verification: 'technician_validated',
      affects: {
        analysisGeometry: 'parcel',
        detected: [],
        canRuleOutUndetectedAffects: false,
        warnings: [],
      },
    })

    expect(selection.current).toMatchObject({
      selectionType: 'whole_parcel',
      geometry,
      surfaceSquareMetres: 8260,
      parcelSurfaceSquareMetres: 8260,
    })
  })

  it('conserva la geometría parcelaria implícita y versiona cambios y revocaciones', () => {
    const first = createDetectedZoneActionArea({
      candidate: candidate('zone-a', 'SNR', 'SNRSC', 'CASCAS'),
      selectedBy: 'architect-a',
      selectedAt: '2026-08-04T10:00:00.000Z',
      verification: 'technician_validated',
    })
    expect(first?.current).toMatchObject({
      selectedCandidateId: 'zone-a',
      surfaceSquareMetres: 1828.24,
      parcelSurfaceSquareMetres: 8260,
      classification: 'SNR',
      category: 'SNRSC',
      planningZone: 'CASCAS',
    })

    const second = createDetectedZoneActionArea({
      candidate: candidate('zone-b', 'SR', 'SRP', 'RESTO'),
      selectedBy: 'architect-a',
      selectedAt: '2026-08-04T11:00:00.000Z',
      verification: 'unverified',
      previous: first,
    })
    expect(second?.history).toHaveLength(1)
    expect(second?.current?.previousSnapshot?.selectedCandidateId).toBe('zone-a')

    const revoked = revokeActionAreaSelection(second, 'architect-a', '2026-08-04T12:00:00.000Z')
    expect(revoked.current).toBeUndefined()
    expect(revoked.history.map((item) => item.selectedCandidateId)).toEqual(['zone-a', 'zone-b'])
  })

  it('rechaza candidatos que no tienen geometría de intersección', () => {
    const withoutGeometry = candidate('zone-a', 'SNR', 'SNRSC', 'CASCAS')
    withoutGeometry.parcelCoverage = undefined
    expect(createDetectedZoneActionArea({
      candidate: withoutGeometry,
      selectedBy: 'architect-a',
      selectedAt: '2026-08-04T10:00:00.000Z',
      verification: 'technician_validated',
    })).toBeUndefined()
  })

  it('keeps a detected zone pending rather than as a technician selection', () => {
    const selection = createDetectedZoneActionArea({
      candidate: candidate('zone-a', 'SNR', 'SNRSC', 'CASCAS'),
      selectedBy: 'architect-a',
      selectedAt: '2026-08-04T10:00:00.000Z',
      verification: 'unverified',
    })?.current

    const facts = applyActionAreaToUrbanisticFacts(automaticFacts(), undefined, selection)

    expect(selection).toMatchObject({
      selectionType: 'detected_zone',
      verification: 'unverified',
      classification: 'SNR',
      category: 'SNRSC',
    })
    expect(selection).not.toHaveProperty('ordinance')
    expect(facts.classification).toMatchObject({
      status: 'manual_review_required',
      origin: 'spatial_intersection',
      nextAction: 'manual_selection',
    })
    expect(facts.category).toMatchObject({
      status: 'manual_review_required',
      origin: 'spatial_intersection',
      nextAction: 'manual_selection',
    })
  })

  it('preserves automatic facts for the exact single official candidate of a clear resolution', () => {
    const officialCandidate = candidate('zone-a', 'SR', 'SRP', 'RESTO')
    const selection = createDetectedZoneActionArea({
      candidate: officialCandidate,
      selectedBy: 'architect-a',
      selectedAt: '2026-08-11T10:00:00.000Z',
      verification: 'unverified',
    })?.current
    const resolution = clearResolution(officialCandidate)
    const facts = automaticFacts()

    expect(matchesClearAutomaticDetectedZone(resolution, selection, facts)).toBe(true)
    expect(applyActionAreaToUrbanisticFacts(facts, resolution, selection)).toBe(facts)
    expect(facts.classification.status).toBe('automatic_confirmed')
    expect(facts.category.status).toBe('automatic_confirmed')
  })

  it('keeps review when the stored automatic facts no longer confirm the candidate', () => {
    const officialCandidate = candidate('zone-a', 'SR', 'SRP', 'RESTO')
    const selection = createDetectedZoneActionArea({
      candidate: officialCandidate,
      selectedBy: 'architect-a',
      selectedAt: '2026-08-11T10:00:00.000Z',
      verification: 'unverified',
    })?.current
    const facts = automaticFacts()
    facts.category.status = 'manual_review_required'

    expect(
      matchesClearAutomaticDetectedZone(clearResolution(officialCandidate), selection, facts)
    ).toBe(false)
  })

  it.each([
    {
      name: 'the selected candidate is different',
      alter: (resolution: TerritorialResolution, selection: NonNullable<ReturnType<typeof createDetectedZoneActionArea>>['current']) => {
        selection!.selectedCandidateId = 'different-candidate'
        return resolution
      },
    },
    {
      name: 'there are several candidates',
      alter: (resolution: TerritorialResolution) => {
        resolution.planning.classificationResolution!.candidates.push(
          candidate('zone-b', 'SR', 'SRP', 'RESTO')
        )
        return resolution
      },
    },
    {
      name: 'the resolution requires review',
      alter: (resolution: TerritorialResolution) => {
        resolution.planning.classificationResolution!.status = 'review_required'
        resolution.planning.classificationResolution!.nextAction = 'review_official_sources'
        return resolution
      },
    },
    {
      name: 'a manual final selection exists',
      alter: (resolution: TerritorialResolution) => {
        resolution.planning.classificationResolution!.finalSelection = {
          origin: 'manual',
          candidateId: 'zone-a',
          classificationCode: 'SR',
          categoryCode: 'SRP',
          areaNames: ['RESTO'],
          technicianValidated: false,
        }
        return resolution
      },
    },
    {
      name: 'the selected area is different',
      alter: (resolution: TerritorialResolution, selection: NonNullable<ReturnType<typeof createDetectedZoneActionArea>>['current']) => {
        selection!.planningZone = 'OTHER'
        selection!.planningZones = ['OTHER']
        return resolution
      },
    },
    {
      name: 'the selected classification is different',
      alter: (resolution: TerritorialResolution, selection: NonNullable<ReturnType<typeof createDetectedZoneActionArea>>['current']) => {
        selection!.classification = 'SU'
        return resolution
      },
    },
    {
      name: 'the single candidate contains several operational areas',
      alter: (resolution: TerritorialResolution, selection: NonNullable<ReturnType<typeof createDetectedZoneActionArea>>['current']) => {
        const official = resolution.planning.classificationResolution!.candidates[0]
        if (official.kind !== 'official_classification') throw new Error('Invalid fixture')
        official.areas.push({ type: 'zone', name: 'SECOND', sourceFeatureIds: ['zone-a-2'] })
        resolution.planning.classificationResolution!.automaticSelection!.areaNames = [
          'RESTO',
          'SECOND',
        ]
        selection!.planningZone = undefined
        selection!.planningZones = ['RESTO', 'SECOND']
        return resolution
      },
    },
    {
      name: 'an official source check is incomplete',
      alter: (resolution: TerritorialResolution) => {
        resolution.planning.classificationResolution!.sourceChecks = [{
          source: 'siotuga',
          status: 'partial',
          checkedAt: '2026-08-11T10:00:00.000Z',
          message: 'La comprobación oficial quedó incompleta.',
        }]
        return resolution
      },
    },
    {
      name: 'a review proposal remains attached to the resolution',
      alter: (resolution: TerritorialResolution) => {
        resolution.planning.classificationResolution!.proposal = {
          candidateId: 'zone-a',
          explanation: 'La selección todavía requiere revisión.',
          confidence: 'medium',
          requiresProfessionalReview: true,
        }
        return resolution
      },
    },
    {
      name: 'the selected geometry differs from the official intersection',
      alter: (resolution: TerritorialResolution, selection: NonNullable<ReturnType<typeof createDetectedZoneActionArea>>['current']) => {
        selection!.geometry = {
          ...selection!.geometry,
          coordinates: [[[[-8.3, 43.3], [-8.29, 43.3], [-8.3, 43.31], [-8.3, 43.3]]]],
        }
        return resolution
      },
    },
  ])('keeps technical review when $name', ({ alter }) => {
    const officialCandidate = candidate('zone-a', 'SR', 'SRP', 'RESTO')
    const selection = createDetectedZoneActionArea({
      candidate: officialCandidate,
      selectedBy: 'architect-a',
      selectedAt: '2026-08-11T10:00:00.000Z',
      verification: 'unverified',
    })?.current
    const resolution = alter(clearResolution(officialCandidate), selection)

    expect(matchesClearAutomaticDetectedZone(resolution, selection, automaticFacts())).toBe(false)
    expect(
      applyActionAreaToUrbanisticFacts(automaticFacts(), resolution, selection)
        .classification.status
    ).toBe('manual_review_required')
  })

  it('accepts categoryLabel as the exact legacy area when candidate.areas is empty', () => {
    const officialCandidate = candidate('zone-a', 'SR', 'SRP', 'IGNORED')
    if (officialCandidate.kind !== 'official_classification') throw new Error('Invalid fixture')
    officialCandidate.areas = []
    officialCandidate.classification.categoryLabel = 'Protección ordinaria'
    const selection = createDetectedZoneActionArea({
      candidate: officialCandidate,
      selectedBy: 'architect-a',
      selectedAt: '2026-08-11T10:00:00.000Z',
      verification: 'unverified',
    })?.current

    expect(selection).toMatchObject({
      planningZone: 'Protección ordinaria',
      planningZones: ['Protección ordinaria'],
    })
    delete selection!.planningZones
    expect(
      matchesClearAutomaticDetectedZone(
        clearResolution(officialCandidate),
        selection,
        automaticFacts()
      )
    ).toBe(true)
  })

  it('keeps the same zone when explicitly confirmed by a technician', () => {
    const selection = createDetectedZoneActionArea({
      candidate: candidate('zone-a', 'SNR', 'SNRSC', 'CASCAS'),
      selectedBy: 'architect-a',
      selectedAt: '2026-08-04T10:00:00.000Z',
      verification: 'technician_validated',
    })?.current

    const facts = applyActionAreaToUrbanisticFacts(automaticFacts(), undefined, selection)

    expect(selection).toMatchObject({
      selectedCandidateId: 'zone-a',
      verification: 'technician_validated',
    })
    expect(facts.classification).toMatchObject({
      status: 'technician_validated',
      origin: 'technician_confirmation',
    })
    expect(facts.category).toMatchObject({
      status: 'technician_validated',
      origin: 'technician_confirmation',
    })
  })
})
