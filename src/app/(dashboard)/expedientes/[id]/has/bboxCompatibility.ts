type Bbox = { minLat: number; minLng: number; maxLat: number; maxLng: number }

const BBOX_TOLERANCE = 1e-9

export function bboxesCompatible(a: unknown, b: unknown) {
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const left = a as Partial<Bbox>
  const right = b as Partial<Bbox>
  return (['minLat', 'minLng', 'maxLat', 'maxLng'] as const).every(key =>
    typeof left[key] === 'number' && typeof right[key] === 'number' && Math.abs(left[key] - right[key]) <= BBOX_TOLERANCE,
  )
}
