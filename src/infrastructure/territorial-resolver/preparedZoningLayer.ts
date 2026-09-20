import crypto from 'node:crypto'
import polygonClipping from 'polygon-clipping'

export type PreparedCoordinate = [number, number]

/** A persisted control remains traceable to an official source and feature. */
export interface PreparedTiePoint {
  id?: string
  pixel: PreparedCoordinate
  coordinate: PreparedCoordinate
  referenceSourceId?: string
  referenceFeatureId?: string
  capability?: string
  label?: string
  residualMetres?: number
}

export interface PreparedReferenceSource {
  id: string
  authority: string
  sourceUrl: string
  crs: string
  capabilities: string[]
  provenance: string[]
}

export interface PreparedGeoreference {
  method: 'affine'
  targetCrs: string
  metricCrs: string
  sourcePixelSpace: { width?: number; height?: number; page?: number }
  transformation: { x: [number, number, number]; y: [number, number, number] }
  rmsMetres: number
  residuals: Array<{ pointId: string; metres: number; leaveOneOutMetres?: number; isOutlier: boolean; exceedsAutomaticCriterion?: boolean }>
  validationStatus: 'VALIDATED'
  validationMethod: 'AUTO_ACCEPTED' | 'TECHNICIAN_CONFIRMED'
  qualityStatus: 'AUTO_ACCEPTABLE' | 'REVIEW_REQUIRED'
  qualityFlags: string[]
  automaticCriteriaWarning?: string
  validationPurpose?: string
  reviewer: string
  validatedAt: string
}

export interface PreparedZoneInput {
  pixelGeometry: number[][][]
  code: string
  label: string
  ordinance: string
  normativeArticle: string
  legendEvidence: string
  documentaryEvidence: string
  confidence: 'high' | 'medium'
}

export interface PreparedZoningZone {
  geometry: { type: 'Polygon'; coordinates: number[][][] }
  code: string
  label: string
  ordinance: string
  normativeArticle: string
  legendEvidence: string
  documentaryEvidence: string
  confidence: 'high' | 'medium'
}

export interface PreparedZoningLayer {
  municipalityCode: string
  instrumentId: string
  sourceDocumentId: string
  sourceSheet: string
  sourceUrl: string
  sourceScale: number
  sourceHash: string
  georeferencingMethod: 'affine'
  targetCrs: string
  metricCrs: string
  sourcePixelSpace: { width?: number; height?: number; page?: number }
  referenceSources: PreparedReferenceSource[]
  tiePoints: PreparedTiePoint[]
  transformation: { x: [number, number, number]; y: [number, number, number] }
  rmsMetres: number
  residuals: PreparedGeoreference['residuals']
  validationStatus: 'VALIDATED'
  validationMethod: PreparedGeoreference['validationMethod']
  qualityStatus: PreparedGeoreference['qualityStatus']
  qualityFlags: string[]
  automaticCriteriaWarning?: string
  validationPurpose?: string
  reviewer: string
  validatedAt: string
  zones: PreparedZoningZone[]
  provenance: string[]
}

export type MetricDistance = (from: PreparedCoordinate, to: PreparedCoordinate) => number

function solve3(matrix: number[][], vector: number[]) {
  const a = matrix.map((row, index) => [...row, vector[index]!])
  for (let column = 0; column < 3; column += 1) {
    let pivot = column
    for (let row = column + 1; row < 3; row += 1) if (Math.abs(a[row]![column]!) > Math.abs(a[pivot]![column]!)) pivot = row
    if (Math.abs(a[pivot]![column]!) < 1e-12) return undefined
    ;[a[column], a[pivot]] = [a[pivot]!, a[column]!]
    const divisor = a[column]![column]!
    for (let index = column; index < 4; index += 1) a[column]![index] = a[column]![index]! / divisor
    for (let row = 0; row < 3; row += 1) {
      if (row === column) continue
      const factor = a[row]![column]!
      for (let index = column; index < 4; index += 1) a[row]![index] = a[row]![index]! - factor * a[column]![index]!
    }
  }
  return [a[0]![3]!, a[1]![3]!, a[2]![3]!] as [number, number, number]
}

function transform(point: PreparedCoordinate, coefficients: { x: [number, number, number]; y: [number, number, number] }): PreparedCoordinate {
  return [
    coefficients.x[0] * point[0] + coefficients.x[1] * point[1] + coefficients.x[2],
    coefficients.y[0] * point[0] + coefficients.y[1] * point[1] + coefficients.y[2],
  ]
}

/**
 * Fits coordinates already expressed in a common target CRS. Callers that use
 * geographic coordinates must supply a metric distance adapter; no CRS is
 * assumed here.
 */
export function fitPreparedAffine(points: PreparedTiePoint[], distanceMetres: MetricDistance = ([x1, y1], [x2, y2]) => Math.hypot(x1 - x2, y1 - y2)) {
  if (points.length < 4) throw new Error('At least four validated control points are required')
  const normal = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  const targetX = [0, 0, 0]
  const targetY = [0, 0, 0]
  for (const point of points) {
    const row = [point.pixel[0], point.pixel[1], 1]
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) normal[i]![j] += row[i]! * row[j]!
      targetX[i] += row[i]! * point.coordinate[0]
      targetY[i] += row[i]! * point.coordinate[1]
    }
  }
  const x = solve3(normal, targetX)
  const y = solve3(normal, targetY)
  if (!x || !y) throw new Error('Control points are degenerate')
  const transformation = { x, y }
  const residuals = points.map((point, index) => ({
    pointId: point.id ?? `P${index + 1}`,
    metres: distanceMetres(transform(point.pixel, transformation), point.coordinate),
    isOutlier: false,
  }))
  const rmsMetres = Math.sqrt(residuals.reduce((sum, residual) => sum + residual.metres ** 2, 0) / residuals.length)
  return { ...transformation, rmsMetres, residuals }
}

function transformRing(ring: number[][], transformation: { x: [number, number, number]; y: [number, number, number] }) {
  return ring.map(([pixelX, pixelY]) => [
    transformation.x[0] * pixelX + transformation.x[1] * pixelY + transformation.x[2],
    transformation.y[0] * pixelX + transformation.y[1] * pixelY + transformation.y[2],
  ])
}

function ringArea(ring: number[][]) {
  let area = 0
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index]!
    const next = ring[(index + 1) % ring.length]!
    area += current[0]! * next[1]! - next[0]! * current[1]!
  }
  return Math.abs(area) / 2
}

function multiPolygonArea(polygons: number[][][][]) {
  return polygons.reduce((total, polygon) => total + ringArea(polygon[0] ?? []) - polygon.slice(1).reduce((holes, hole) => holes + ringArea(hole), 0), 0)
}

type PreparationBase = Omit<PreparedZoningLayer, 'sourceHash' | 'georeferencingMethod' | 'targetCrs' | 'metricCrs' | 'sourcePixelSpace' | 'referenceSources' | 'transformation' | 'rmsMetres' | 'residuals' | 'validationStatus' | 'validationMethod' | 'qualityStatus' | 'qualityFlags' | 'automaticCriteriaWarning' | 'validationPurpose' | 'zones' | 'provenance' | 'tiePoints' | 'reviewer' | 'validatedAt'>

export function buildPreparedZoningLayer(input: PreparationBase & {
  rasterBytes: Uint8Array
  tiePoints: PreparedTiePoint[]
  pixelZones: PreparedZoneInput[]
  reviewer: string
  validatedAt: string
  targetCrs?: string
  metricCrs?: string
  sourcePixelSpace?: { width?: number; height?: number; page?: number }
  referenceSources?: PreparedReferenceSource[]
  validatedGeoreference: PreparedGeoreference
}) {
  if (!input.reviewer.trim()) throw new Error('Explicit reviewer is required')
  if (input.tiePoints.length < 4 || input.tiePoints.length > 12) throw new Error('Between four and twelve control points are required')
  if (!input.validatedGeoreference) throw new Error('An explicitly validated georeference is required')
  const georeference = input.validatedGeoreference
  if (georeference.validationStatus !== 'VALIDATED') throw new Error('A validated georeference is required')
  if (georeference.reviewer !== input.reviewer || georeference.validatedAt !== input.validatedAt) throw new Error('Reviewer provenance must match the validated georeference')
  const coefficients = [...georeference.transformation.x, ...georeference.transformation.y]
  const determinant = georeference.transformation.x[0] * georeference.transformation.y[1]
    - georeference.transformation.x[1] * georeference.transformation.y[0]
  if (!coefficients.every(Number.isFinite) || Math.abs(determinant) < 1e-12) throw new Error('A finite, non-degenerate georeference is required')
  if (!Number.isFinite(georeference.rmsMetres) || georeference.residuals.some((residual) => !Number.isFinite(residual.metres))) {
    throw new Error('Finite georeferencing metrics are required')
  }
  if (georeference.qualityStatus === 'REVIEW_REQUIRED' && georeference.validationMethod !== 'TECHNICIAN_CONFIRMED') {
    throw new Error('A warning-bearing georeference requires explicit technician confirmation')
  }
  const zones = input.pixelZones.map((zone) => ({
    ...zone,
    geometry: { type: 'Polygon' as const, coordinates: zone.pixelGeometry.map((ring) => transformRing(ring, georeference.transformation)) },
  }))
  if (zones.length === 0) throw new Error('At least one validated zoning polygon is required')
  const sourceHash = crypto.createHash('sha256').update(input.rasterBytes).digest('hex')
  return {
    municipalityCode: input.municipalityCode,
    instrumentId: input.instrumentId,
    sourceDocumentId: input.sourceDocumentId,
    sourceSheet: input.sourceSheet,
    sourceUrl: input.sourceUrl,
    sourceScale: input.sourceScale,
    sourceHash,
    georeferencingMethod: georeference.method,
    targetCrs: georeference.targetCrs,
    metricCrs: georeference.metricCrs,
    sourcePixelSpace: georeference.sourcePixelSpace,
    referenceSources: input.referenceSources ?? [],
    tiePoints: input.tiePoints,
    transformation: georeference.transformation,
    rmsMetres: georeference.rmsMetres,
    residuals: georeference.residuals,
    validationStatus: georeference.validationStatus,
    validationMethod: georeference.validationMethod,
    qualityStatus: georeference.qualityStatus,
    qualityFlags: georeference.qualityFlags,
    automaticCriteriaWarning: georeference.automaticCriteriaWarning,
    validationPurpose: georeference.validationPurpose,
    reviewer: georeference.reviewer,
    validatedAt: georeference.validatedAt,
    zones,
    provenance: [
      `source:official-raster:${input.sourceSheet}`,
      `sha256:${sourceHash}`,
      `target-crs:${georeference.targetCrs}`,
      `metric-crs:${georeference.metricCrs}`,
      `control-points:${input.tiePoints.length}`,
      `reviewer:${georeference.reviewer}`,
      `rms-metres:${georeference.rmsMetres.toFixed(3)}`,
      `validation-method:${georeference.validationMethod}`,
      `quality-status:${georeference.qualityStatus}`,
      ...georeference.qualityFlags.map((flag) => `quality-flag:${flag}`),
    ],
  } satisfies PreparedZoningLayer
}

export function intersectPreparedZoningLayer(layer: PreparedZoningLayer, parcel: number[][][][]) {
  const parcelArea = multiPolygonArea(parcel)
  if (!parcelArea) return []
  return layer.zones.map((zone) => {
    const intersection = polygonClipping.intersection(parcel as never, [zone.geometry.coordinates] as never) as unknown as number[][][][]; console.log('Intersection:', intersection)
    const area = multiPolygonArea(intersection)
    return { ...zone, coveragePercent: area / parcelArea * 100, intersection }
  }).filter((zone) => zone.coveragePercent > 0)
}

