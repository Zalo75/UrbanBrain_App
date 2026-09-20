export type GeographicBbox = { minLat: number; minLng: number; maxLat: number; maxLng: number }

export function projectParcelGeometryToRaster(geometry: any, bbox: GeographicBbox, width: number, height: number) {
  if (!geometry || geometry.crs !== 'EPSG:4326' || !bbox || width <= 0 || height <= 0) return null
  const rings = geometry.type === 'MultiPolygon' ? geometry.coordinates.flat(1) : geometry.coordinates
  if (!Array.isArray(rings) || bbox.maxLng <= bbox.minLng || bbox.maxLat <= bbox.minLat) return null
  return rings.map((ring: any[]) => ring.map((point: [number, number]) => [
    ((point[0] - bbox.minLng) / (bbox.maxLng - bbox.minLng)) * width,
    ((bbox.maxLat - point[1]) / (bbox.maxLat - bbox.minLat)) * height,
  ]))
}
