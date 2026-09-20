import { describe, expect, it } from 'vitest'
import { projectParcelGeometryToRaster } from './parcelPixelProjection'

describe('parcel projection into the modern raster frame', () => {
  const bbox = { minLng: 0, minLat: 0, maxLng: 10, maxLat: 20 }
  const geometry = { type: 'MultiPolygon', crs: 'EPSG:4326', coordinates: [[[[2, 4], [4, 4], [4, 8], [2, 8], [2, 4]]]] }

  it('preserves geographic width and height ratios in pixels', () => {
    const rings = projectParcelGeometryToRaster(geometry, bbox, 1000, 2000)!
    const xs = rings[0].map((point: number[]) => point[0])
    const ys = rings[0].map((point: number[]) => point[1])
    expect((Math.max(...xs) - Math.min(...xs)) / 1000).toBeCloseTo(0.2)
    expect((Math.max(...ys) - Math.min(...ys)) / 2000).toBeCloseTo(0.2)
  })

  it('places the parcel centre at the same normalized raster position', () => {
    const rings = projectParcelGeometryToRaster(geometry, bbox, 1000, 2000)!
    const xs = rings[0].map((point: number[]) => point[0])
    const ys = rings[0].map((point: number[]) => point[1])
    expect(((Math.min(...xs) + Math.max(...xs)) / 2) / 1000).toBeCloseTo(0.3)
    expect(((Math.min(...ys) + Math.max(...ys)) / 2) / 2000).toBeCloseTo(0.7)
  })

  it('rejects an unaccredited CRS instead of assuming equivalence', () => {
    expect(projectParcelGeometryToRaster({ ...geometry, crs: 'EPSG:25829' }, bbox, 1000, 2000)).toBeNull()
  })
})
