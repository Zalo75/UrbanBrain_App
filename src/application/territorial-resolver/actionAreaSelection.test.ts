import { describe, expect, it } from 'vitest'

import type { ClassificationCandidate, ParcelGeometry } from '@/domain/territorial-resolver/types'
import {
  createDetectedZoneActionArea,
  createWholeParcelActionArea,
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
})
