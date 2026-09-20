import type { ParcelGeometry } from '@/domain/territorial-resolver/types'

export interface HasAlignmentInputV1 {
  schemaVersion: 1
  expedienteId: string

  parcel: {
    cadastralReference: string
    geometry: ParcelGeometry
    geometryFingerprint: string
  }

  municipality: {
    code: string
    name?: string
  }

  instrument: {
    id: string
    name?: string
  }

  raster: {
    officialDocumentId: string
    sourceUrl: string
    sourceHash: string
    format: 'pdf' | 'png' | 'jpg' | 'tiff'
    pixelSpace: {
      width: number
      height: number
      page?: number
    }
    provenance: string[]
  }

  targetFrame: {
    crs: string
  }

  fallbackEvidence: {
    reason: 'OFFICIAL_RASTER_WITHOUT_USABLE_SPATIAL_REFERENCE'
    higherPrioritySourceChecks: Array<{
      provider: string
      status: string
      reason?: string
    }>
    rejectedGeoreference?: {
      method?: string
      reason: string
    }
  }
}

export interface HasAlignmentResultV1 {
  schemaVersion: 1
  transformOrder: 'T_R_S'

  expedienteId: string
  municipalityCode: string
  instrumentId: string

  parcel: {
    cadastralReference: string
    geometryFingerprint: string
  }

  raster: {
    officialDocumentId: string
    sourceUrl: string
    sourceHash: string
    page?: number
    pixelWidth: number
    pixelHeight: number
  }

  sourcePixelPivot: { x: number; y: number }
  target: {
    crs: string
    pivot: { x: number; y: number }
  }
  rotationDegrees: number
  scaleX: number
  scaleY: number

  opacity: number
  completedAt: string
  operator: {
    kind: 'human' | 'luna'
    id: string
  }
  provenance: string[]
}

export interface Point2D {
  x: number
  y: number
}

export interface DerivedAffine {
  a: number
  b: number
  d: number
  e: number
  tx: number
  ty: number
}

export function assertValidPoint(p: Point2D) {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
    throw new Error('Las coordenadas del punto deben ser finitas')
  }
}

export function assertValidTransformParams(
  sourcePivot: Point2D,
  targetPivot: Point2D,
  rotationDegrees: number,
  scaleX: number,
  scaleY: number
) {
  assertValidPoint(sourcePivot)
  assertValidPoint(targetPivot)
  
  if (!Number.isFinite(rotationDegrees)) {
    throw new Error('Rotación inválida')
  }
  if (!Number.isFinite(scaleX) || scaleX <= 0) {
    throw new Error('scaleX debe ser > 0')
  }
  if (!Number.isFinite(scaleY) || scaleY <= 0) {
    throw new Error('scaleY debe ser > 0')
  }
}

/**
 * Deriva los coeficientes de una matriz afín a partir de los parámetros canónicos T·R·S.
 * 
 * q = t + R(θ) · diag(sx, sy) · (p - c)
 * 
 * Donde:
 * a = cos(θ) · sx
 * b = -sin(θ) · sy
 * d = sin(θ) · sx
 * e = cos(θ) · sy
 * 
 * x' = a*u + b*v + (tx - a*cx - b*cy)
 * y' = d*u + e*v + (ty - d*cx - e*cy)
 */
export function deriveAffineFromTRS(
  sourcePivot: Point2D,
  targetPivot: Point2D,
  rotationDegrees: number,
  scaleX: number,
  scaleY: number
): DerivedAffine {
  assertValidTransformParams(sourcePivot, targetPivot, rotationDegrees, scaleX, scaleY)

  const rad = rotationDegrees * (Math.PI / 180)
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)

  const a = cos * scaleX
  const b = -sin * scaleY
  const d = sin * scaleX
  const e = cos * scaleY

  const tx = targetPivot.x - (a * sourcePivot.x + b * sourcePivot.y)
  const ty = targetPivot.y - (d * sourcePivot.x + e * sourcePivot.y)

  return { a, b, d, e, tx, ty }
}

/**
 * Transforma un punto usando la fórmula directa T·R·S.
 * Escala (local) -> Rotación -> Traslación
 */
export function transformPointTRS(
  p: Point2D,
  sourcePivot: Point2D,
  targetPivot: Point2D,
  rotationDegrees: number,
  scaleX: number,
  scaleY: number
): Point2D {
  assertValidPoint(p)
  assertValidTransformParams(sourcePivot, targetPivot, rotationDegrees, scaleX, scaleY)

  const dx = p.x - sourcePivot.x
  const dy = p.y - sourcePivot.y

  const scaledX = dx * scaleX
  const scaledY = dy * scaleY

  const rad = rotationDegrees * (Math.PI / 180)
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)

  const rx = scaledX * cos - scaledY * sin
  const ry = scaledX * sin + scaledY * cos

  return {
    x: targetPivot.x + rx,
    y: targetPivot.y + ry
  }
}

/**
 * Transforma un punto usando los coeficientes derivados afines.
 */
export function transformPointAffine(
  p: Point2D,
  affine: DerivedAffine
): Point2D {
  assertValidPoint(p)
  if (!Number.isFinite(affine.a) || !Number.isFinite(affine.b) || !Number.isFinite(affine.tx) ||
      !Number.isFinite(affine.d) || !Number.isFinite(affine.e) || !Number.isFinite(affine.ty)) {
    throw new Error('Matriz afín inválida')
  }

  return {
    x: affine.a * p.x + affine.b * p.y + affine.tx,
    y: affine.d * p.x + affine.e * p.y + affine.ty
  }
}
