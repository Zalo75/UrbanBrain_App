import { describe, expect, it } from 'vitest'
import { overlayParcelOnPng, projectParcelGeometryToPixels } from './parcelMapOverlay'

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64'))
const geometry = {
  type: 'MultiPolygon' as const,
  coordinates: [[[[ -8.2, 43.2 ], [ -8.1, 43.2 ], [ -8.1, 43.1 ], [ -8.2, 43.1 ], [ -8.2, 43.2 ]]]],
  crs: 'EPSG:4326' as const,
}
const bbox = { minLat: 43, minLng: -8.3, maxLat: 43.3, maxLng: -8 }

describe('parcelMapOverlay', () => {
  it('projects EPSG:4326 geometry to image pixels deterministically', () => {
    const rings = projectParcelGeometryToPixels(geometry, bbox, 100, 100)
    expect(rings[0]?.[0]?.[0]).toEqual({ x: expect.closeTo(33, 1), y: expect.closeTo(33, 1) })
  })

  it('keeps the requested bbox unchanged and produces a marked PNG', () => {
    const before = { ...bbox }
    const marked = overlayParcelOnPng(PNG, geometry, bbox)
    expect(marked?.length).toBeGreaterThan(0)
    expect(bbox).toEqual(before)
  })
})
