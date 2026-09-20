import { describe, expect, it } from 'vitest'
import { bboxesCompatible } from './bboxCompatibility'

describe('HAS BBOX compatibility', () => {
  it('ignores property order', () => {
    const bboxA = { minLat: 43.267044999999996, minLng: -8.219547, maxLat: 43.272921000000004, maxLng: -8.213709999999999 }
    const bboxB = { maxLat: 43.272921000000004, maxLng: -8.213709999999999, minLat: 43.267044999999996, minLng: -8.219547 }
    expect(bboxesCompatible(bboxA, bboxB)).toBe(true)
  })

  it('rejects a material coordinate change', () => {
    const bbox = { minLat: 43.267044999999996, minLng: -8.219547, maxLat: 43.272921000000004, maxLng: -8.213709999999999 }
    expect(bboxesCompatible(bbox, { ...bbox, maxLat: bbox.maxLat + 0.001 })).toBe(false)
  })
})
