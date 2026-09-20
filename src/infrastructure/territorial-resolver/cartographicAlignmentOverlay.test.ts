// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { renderCartographicAlignment } from './cartographicAlignmentOverlay'
import { decodePng, encodePng } from './parcelMapOverlay'

const bbox = { minLat: 0, minLng: 0, maxLat: 1, maxLng: 1 }
function raster(color: number[]) {
  const pixels = new Uint8Array(64 * 64 * 4)
  for (let i = 0; i < pixels.length; i += 4) pixels.set(color, i)
  return { bytes: encodePng(64, 64, pixels), bbox, width: 64, height: 64 }
}
const identity = { sourcePixelPivot: { x: 0, y: 0 }, targetPixelPivot: { x: 0, y: 0 }, rotationDegrees: 0, scaleX: 1, scaleY: 1 }
describe('deterministic alignment rendering', () => {
  it('renders opacity endpoints and repeats from immutable input bytes', () => {
    const a = raster([255, 0, 0, 255]), b = raster([0, 0, 255, 255])
    const before = Buffer.from(a.bytes)
    expect(renderCartographicAlignment(a, b, b, identity, 0)).toEqual(b.bytes)
    expect(renderCartographicAlignment(a, b, b, identity, 1)).toEqual(a.bytes)
    const first = renderCartographicAlignment(a, b, b, identity, 0.5)
    expect(renderCartographicAlignment(a, b, b, identity, 0.5)).toEqual(first)
    expect(a.bytes).toEqual(before)
    expect([...decodePng(first)!.pixels.slice(0, 4)]).toEqual([128, 0, 128, 255])
  })
  it('uses local anisotropic scale before rotation, then translation', () => {
    const pixels = new Uint8Array(64 * 64 * 4)
    pixels.set([255, 0, 0, 255], (3 * 64 + 2) * 4)
    const a = { ...raster([0, 0, 0, 0]), bytes: encodePng(64, 64, pixels) }
    const b = raster([0, 0, 255, 255])
    const transform = { ...identity, targetPixelPivot: { x: 20, y: 10 }, rotationDegrees: 90, scaleX: 2, scaleY: 3 }
    // (2,3) -> (4,9) -> (-9,4) -> (11,14).
    const rendered = decodePng(renderCartographicAlignment(a, b, b, transform, 1))!
    expect([...rendered.pixels.slice((14 * 64 + 11) * 4, (14 * 64 + 11) * 4 + 4)]).toEqual([255, 0, 0, 255])
    expect([...rendered.pixels.slice((16 * 64 + 14) * 4, (16 * 64 + 14) * 4 + 4)]).toEqual([0, 0, 255, 255])
  })
  it('keeps canonical transform when inspecting a different extent', () => {
    const pixels = new Uint8Array(64 * 64 * 4)
    pixels.set([255, 0, 0, 255], (20 * 64 + 20) * 4)
    const a = { ...raster([0, 0, 0, 0]), bytes: encodePng(64, 64, pixels) }
    const b = raster([0, 0, 255, 255])
    const crop = { ...b, bbox: { minLng: 10 / 63, maxLng: 41.5 / 63, maxLat: 1 - 10 / 63, minLat: 1 - 41.5 / 63 } }
    const transform = structuredClone(identity)
    const result = decodePng(renderCartographicAlignment(a, b, crop, transform, 1))!
    expect([...result.pixels.slice((20 * 64 + 20) * 4, (20 * 64 + 20) * 4 + 4)]).toEqual([255, 0, 0, 255])
    expect(transform).toEqual(identity)
  })
  it('rejects invalid scales and decompression-sized rasters', () => {
    const a = raster([0, 0, 0, 255])
    expect(() => renderCartographicAlignment(a, a, a, { ...identity, scaleY: 0 }, 1)).toThrow()
    expect(() => renderCartographicAlignment(a, a, a, { ...identity, scaleX: Number.MIN_VALUE, scaleY: Number.MIN_VALUE }, 1)).toThrow('Numerically invalid')
    const tooLarge = Buffer.from(a.bytes)
    tooLarge.writeUInt32BE(20000, 16)
    expect(decodePng(tooLarge)).toBeUndefined()
  })
})
