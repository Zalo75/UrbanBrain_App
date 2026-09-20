import polygonClipping from 'polygon-clipping'
import type { ClassificationCandidate, ParcelGeometry } from './types'

export interface ParcelAccounting {
  status: 'accounted' | 'unresolved' | 'invalid_geometry'
  analysedSurfaceSquareMetres?: number
  coveredSurfaceSquareMetres?: number
  unresolvedSurfaceSquareMetres?: number
  overlapSurfaceSquareMetres?: number
  unresolvedGeometry?: ParcelGeometry
  toleranceSquareMetres: number
  method: 'geometry_union_difference'
  portions: Array<{ candidateId: string; geometry: ParcelGeometry; surfaceSquareMetres: number; evidence: ClassificationCandidate['evidence'] }>
  reasons: string[]
}

/** WGS84 spherical area, subtracting interior rings. This is measured geometry,
 * not a substitute for the cadastral register's declared surface. */
export function geometrySurface(geometry?: ParcelGeometry | null): number | undefined {
  if (!geometry || geometry.crs !== 'EPSG:4326') return undefined
  const radians = Math.PI / 180
  let area = 0
  for (const polygon of geometry.coordinates) {
    for (const [index, ring] of polygon.entries()) {
      if (ring.length < 4 || ring.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 180 || Math.abs(y) > 90)) return undefined
      let sum = 0
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length]
        sum += (b[0] - a[0]) * radians * (2 + Math.sin(a[1] * radians) + Math.sin(b[1] * radians))
      }
      area += (index === 0 ? 1 : -1) * Math.abs(sum * 6371008.8 ** 2 / 2)
    }
  }
  return Number.isFinite(area) && area > 0 ? area : undefined
}

/** Account for the union, never the sum of possibly overlapping observations.
 * No coverage means no spatial classification evidence, not no planning. */
export function accountParcelGeometry(geometry: ParcelGeometry | undefined, candidates: ClassificationCandidate[] = []): ParcelAccounting {
  const total = geometrySurface(geometry)
  const base: ParcelAccounting = { status: 'unresolved', toleranceSquareMetres: Math.max(1, (total ?? 0) * 0.005), method: 'geometry_union_difference', portions: [], reasons: [] }
  if (!geometry || total === undefined) return { ...base, status: geometry ? 'invalid_geometry' : 'unresolved', reasons: ['Analysed geometry unavailable or invalid; surface is UNKNOWN.'] }
  base.analysedSurfaceSquareMetres = total
  const wrap = (coordinates: number[][][][]): ParcelGeometry => ({ type: 'MultiPolygon', crs: 'EPSG:4326', coordinates })
  const asClip = (value: ParcelGeometry) => value.coordinates as polygonClipping.MultiPolygon
  try {
    for (const candidate of candidates) {
      const intersection = candidate.parcelCoverage?.intersectionGeometry
      if (!intersection || candidate.kind !== 'official_classification') continue
      const clipped = wrap(polygonClipping.intersection(asClip(geometry), asClip(intersection)))
      const surface = geometrySurface(clipped)
      if (surface) base.portions.push({ candidateId: candidate.id, geometry: clipped, surfaceSquareMetres: surface, evidence: candidate.evidence })
    }
    const union = base.portions.length ? polygonClipping.union(asClip(base.portions[0].geometry), ...base.portions.slice(1).map(p => asClip(p.geometry))) : []
    const remainder = union.length ? polygonClipping.difference(asClip(geometry), union) : geometry.coordinates
    const covered = geometrySurface(wrap(union)) ?? 0
    const unresolved = geometrySurface(wrap(remainder)) ?? 0
    base.coveredSurfaceSquareMetres = covered
    base.unresolvedSurfaceSquareMetres = unresolved
    base.overlapSurfaceSquareMetres = Math.max(0, base.portions.reduce((sum, p) => sum + p.surfaceSquareMetres, 0) - covered)
    if (remainder.length) base.unresolvedGeometry = wrap(remainder)
    if (Math.abs(total - covered - unresolved) > base.toleranceSquareMetres) base.reasons.push('Geometry area reconciliation exceeds tolerance.')
    if (unresolved > 0) base.reasons.push('Portion without spatial classification evidence; planning may still apply.')
    if (base.overlapSurfaceSquareMetres > base.toleranceSquareMetres) base.reasons.push('Overlapping classification observations require reconciliation.')
    base.status = base.reasons.length ? 'unresolved' : 'accounted'
    return base
  } catch {
    return { ...base, status: 'invalid_geometry', unresolvedGeometry: geometry, unresolvedSurfaceSquareMetres: total, reasons: ['Geometry intersection failed; complete analysed geometry retained as unresolved.'] }
  }
}
