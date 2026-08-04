import { describe, expect, it } from 'vitest'

import type { ManualTerritorialContext } from '@/domain/territorial-resolver/types'

describe('action area JSON persistence contract', () => {
  it('round-trips the current selection, history and parcel/action geometries independently', () => {
    const parcelGeometry = {
      type: 'MultiPolygon' as const,
      crs: 'EPSG:4326' as const,
      coordinates: [[[[-8.22, 43.27], [-8.20, 43.27], [-8.22, 43.29], [-8.22, 43.27]]]],
    }
    const actionGeometry = {
      ...parcelGeometry,
      coordinates: [[[[-8.22, 43.27], [-8.21, 43.27], [-8.22, 43.28], [-8.22, 43.27]]]],
    }
    const manualContext: ManualTerritorialContext = {
      provenance: 'manual',
      verification: 'unverified',
      recordedAt: '2026-08-04T10:00:00.000Z',
      actionAreaSelection: {
        history: [],
        current: {
          id: 'selection-a',
          geometry: actionGeometry,
          surfaceSquareMetres: 1828.24,
          parcelSurfaceSquareMetres: 8260,
          selectionType: 'detected_zone',
          selectedCandidateId: 'zone-a',
          classification: 'SNR',
          category: 'SNRSC',
          planningZone: 'CASCAS',
          source: 'siotuga',
          confidence: 'high',
          selectedBy: 'architect-a',
          selectedAt: '2026-08-04T10:00:00.000Z',
          verification: 'technician_validated',
        },
      },
    }

    const rawResponse = JSON.parse(JSON.stringify({ parcelGeometry, continuity: { manualContext } }))
    expect(rawResponse.parcelGeometry).toEqual(parcelGeometry)
    expect(rawResponse.continuity.manualContext.actionAreaSelection.current.geometry).toEqual(
      actionGeometry
    )
    expect(rawResponse.continuity.manualContext.actionAreaSelection.current.surfaceSquareMetres).toBe(
      1828.24
    )
  })
})
