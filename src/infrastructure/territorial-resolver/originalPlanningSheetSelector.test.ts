import { describe, expect, it } from 'vitest'
import { selectOriginalPlanningSheets } from './originalPlanningSheetSelector'

const document = (id: string, metadata?: Record<string, unknown>) => ({
  id,
  instrumentId: 'current',
  title: `Plano ${id}`,
  sourceUrl: `https://official.invalid/${id}.jpg`,
  binding: 'area_specific' as const,
  documentType: 'sheet' as const,
  ...(metadata ? { metadata } : {}),
})

describe('original planning sheet selector', () => {
  it('projects a parcel point into the only extent-compatible sheet', () => {
    const result = selectOriginalPlanningSheets({
      feature: { instrumentId: 'current', extent: { minLat: 0, minLng: 0, maxLat: 10, maxLng: 10 } },
      documents: [document('a', { minLat: 0, minLng: 0, maxLat: 10, maxLng: 10 }), document('b', { minLat: 20, minLng: 20, maxLat: 30, maxLng: 30 })],
      point: { lat: 5, lng: 5 },
    })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ match: 'metadata', projectedPoint: { x: 0.5, y: 0.5 } })
  })

  it('returns all compatible sheet candidates when no extent can disambiguate them', () => {
    const result = selectOriginalPlanningSheets({
      feature: { instrumentId: 'current', extent: { minLat: 0, minLng: 0, maxLat: 10, maxLng: 10 } },
      documents: [document('a'), document('b')],
      point: { lat: 5, lng: 5 },
    })
    expect(result.map((item) => item.document.id)).toEqual(['a', 'b'])
    expect(result.every((item) => item.match === 'unresolved')).toBe(true)
  })

  it('never mixes sheets from another instrument', () => {
    const result = selectOriginalPlanningSheets({
      feature: { instrumentId: 'current', extent: { minLat: 0, minLng: 0, maxLat: 10, maxLng: 10 } },
      documents: [document('other'), { ...document('current'), instrumentId: 'historical' }],
      point: { lat: 5, lng: 5 },
    })
    expect(result).toHaveLength(1)
    expect(result[0]?.document.instrumentId).toBe('current')
  })
})
