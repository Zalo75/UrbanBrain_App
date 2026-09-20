import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { RasterTiePointExtractor, douglasPeucker } from './rasterTiePointExtractor'

describe('RasterTiePointExtractor', () => {
  it('extracts a deterministic CV footprint without invoking Gemini', async () => {
    const image = await sharp({ create: { width: 80, height: 80, channels: 3, background: { r: 255, g: 255, b: 255 } } }).composite([{ input: { create: { width: 50, height: 50, channels: 3, background: { r: 20, g: 20, b: 20 } } }, left: 15, top: 15 }]).png().toBuffer()
    const result = await new RasterTiePointExtractor().extract(image, [{ id: 'c', geometry: {}, source: '3CLAS', coordinates: [[-8, 42], [-7.99, 42], [-8, 42.01]] }])
    expect(result.vlmExecuted).toBe(false)
    expect(result.tiePoints.length).toBeGreaterThanOrEqual(3)
    expect(result.provenance).toContain('tie-points:ransac')
  })

  it('simplifies a polyline with Douglas-Peucker', () => {
    expect(douglasPeucker([[0, 0], [1, 0.01], [2, 0], [2, 2]], 0.1)).toEqual([[0, 0], [2, 0], [2, 2]])
  })
})
