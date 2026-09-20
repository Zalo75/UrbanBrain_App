/**
 * Provider-neutral preparation contract for historical territorial cartography.
 *
 * Providers discover and render official data. This engine only reasons about
 * declared capabilities, control points, transformations and validation gates.
 */
export type ReferenceCapability =
  | 'target_parcel'
  | 'cadastral_parcels'
  | 'buildings'
  | 'roads'
  | 'street_network'
  | 'blocks'
  | 'orthophoto'
  | 'hydrography'
  | 'administrative_boundaries'
  | 'thematic_geometry'
  | 'physical_anchor'

export type Coordinate = [number, number]
export type TransformModel = 'affine' | 'homography'

export interface HistoricalCartography {
  id: string
  documentId?: string
  sourceUrl: string
  sourceHash?: string
  format: 'jpg' | 'png' | 'tiff' | 'pdf-raster' | 'pdf-vector'
  scaleDenominator?: number
  /** The historical document starts in its native pixel/page coordinate space. */
  pixelSpace: { crs: 'image-pixel'; width?: number; height?: number; page?: number }
  /** Present only when the original document is already georeferenced. */
  declaredCrs?: string
  provenance: readonly string[]
}

export interface OfficialReferenceSource {
  id: string
  authority: string
  crs: string
  capabilities: readonly ReferenceCapability[]
  sourceUrl: string
  official: boolean
  provenance: readonly string[]
}

/** A renderable layer belongs to an official source but is not provider-specific. */
export interface OfficialReferenceLayer {
  id: string
  sourceId: string
  title: string
  crs: string
  capabilities: readonly ReferenceCapability[]
  sourceUrl: string
  featureIds?: readonly string[]
  provenance: readonly string[]
}

export interface GeoreferencingControlPoint {
  id: string
  imageCoordinate: Coordinate
  /** Coordinate in the CRS declared by referenceSourceId. */
  referenceCoordinate: Coordinate
  referenceSourceId: string
  referenceFeatureId?: string
  capability: ReferenceCapability
  label?: string
  provenance?: readonly string[]
}

/** Adapters own CRS conversion and metric calculation; the engine does not. */
export interface SpatialReferencePort {
  targetCrs: string
  metricCrs: string
  toTarget(coordinate: Coordinate, sourceCrs: string): Coordinate
  distanceMetres(from: Coordinate, to: Coordinate): number
}

export interface ValidationPolicy {
  minimumControlPoints: number
  maximumControlPoints: number
  requirePhysicalAnchor: boolean
  /** Optional conservative criteria for unattended acceptance. Never a human-validation gate. */
  automaticAcceptance?: {
    maxRmsMetres: number
    maxResidualMetres: number
  }
}

export type GeoreferencingQualityStatus = 'INVALID' | 'REVIEW_REQUIRED' | 'AUTO_ACCEPTABLE'

export type GeoreferencingQualityFlag =
  | 'AUTOMATIC_CRITERIA_NOT_CONFIGURED'
  | 'RMS_EXCEEDS_AUTOMATIC_CRITERION'
  | 'RESIDUAL_EXCEEDS_AUTOMATIC_CRITERION'

export interface AffineTransform {
  model: 'affine'
  sourcePixelSpace: { crs: 'image-pixel'; width?: number; height?: number; page?: number }
  targetCrs: string
  x: [number, number, number]
  y: [number, number, number]
  inverse?: { x: [number, number, number]; y: [number, number, number] }
}

export interface PointResidual {
  pointId: string
  metres: number
  leaveOneOutMetres?: number
  isOutlier: boolean
  exceedsAutomaticCriterion: boolean
}

export interface GeoreferencingMetrics {
  metricCrs: string
  rmsMetres: number
  residuals: PointResidual[]
  automaticResidualCriterionMetres?: number
}

export interface GeoreferencingAssessment {
  transform?: AffineTransform
  metrics?: GeoreferencingMetrics
  status: GeoreferencingQualityStatus
  canAutomaticallyAccept: boolean
  canTechnicianConfirm: boolean
  /** Compatibility alias: true means mathematically eligible for validation, not automatically accepted. */
  canValidate: boolean
  invalidReasons: string[]
  qualityFlags: GeoreferencingQualityFlag[]
  reasons: string[]
}

export interface TechnicianConfirmation {
  reviewer: string
  timestamp: string
  purpose: string
  inspectedOverlay: boolean
  inspectedParcel: boolean
  inspectedControls: boolean
  inspectedResiduals: boolean
  confirmedSufficientForPurpose: boolean
}

export interface TechnicianConfirmedGeoreference {
  validationStatus: 'VALIDATED'
  validationMethod: 'TECHNICIAN_CONFIRMED'
  qualityStatus: Exclude<GeoreferencingQualityStatus, 'INVALID'>
  qualityFlags: GeoreferencingQualityFlag[]
  automaticCriteriaWarning?: string
  reviewer: string
  validatedAt: string
  purpose: string
  transform: AffineTransform
  metrics: GeoreferencingMetrics
  source: {
    id: string
    sourceUrl: string
    sourceHash?: string
    format: HistoricalCartography['format']
    scaleDenominator?: number
    pixelSpace: HistoricalCartography['pixelSpace']
  }
}

export interface TerritorialPreparationInput {
  historicalCartography: HistoricalCartography
  referenceSources: readonly OfficialReferenceSource[]
  controls: readonly GeoreferencingControlPoint[]
}

const DEFAULT_POLICY: ValidationPolicy = {
  minimumControlPoints: 4,
  maximumControlPoints: 12,
  requirePhysicalAnchor: true,
}

const PHYSICAL_ANCHOR_CAPABILITIES = new Set<ReferenceCapability>([
  'cadastral_parcels',
  'buildings',
  'roads',
  'street_network',
  'blocks',
  'hydrography',
  'physical_anchor',
])

function solve3(matrix: number[][], vector: number[]) {
  const augmented = matrix.map((row, index) => [...row, vector[index]!])
  for (let column = 0; column < 3; column += 1) {
    let pivot = column
    for (let row = column + 1; row < 3; row += 1) {
      if (Math.abs(augmented[row]![column]!) > Math.abs(augmented[pivot]![column]!)) pivot = row
    }
    if (Math.abs(augmented[pivot]![column]!) < 1e-12) return undefined
    ;[augmented[column], augmented[pivot]] = [augmented[pivot]!, augmented[column]!]
    const divisor = augmented[column]![column]!
    for (let index = column; index < 4; index += 1) augmented[column]![index] = augmented[column]![index]! / divisor
    for (let row = 0; row < 3; row += 1) {
      if (row === column) continue
      const factor = augmented[row]![column]!
      for (let index = column; index < 4; index += 1) {
        augmented[row]![index] = augmented[row]![index]! - factor * augmented[column]![index]!
      }
    }
  }
  return [augmented[0]![3]!, augmented[1]![3]!, augmented[2]![3]!] as [number, number, number]
}

function transform(point: Coordinate, affine: Pick<AffineTransform, 'x' | 'y'>): Coordinate {
  return [
    affine.x[0] * point[0] + affine.x[1] * point[1] + affine.x[2],
    affine.y[0] * point[0] + affine.y[1] * point[1] + affine.y[2],
  ]
}

function inverseAffine(affine: Pick<AffineTransform, 'x' | 'y'>): AffineTransform['inverse'] {
  const determinant = affine.x[0] * affine.y[1] - affine.x[1] * affine.y[0]
  if (Math.abs(determinant) < 1e-12) return undefined
  return {
    x: [affine.y[1] / determinant, -affine.x[1] / determinant, (affine.x[1] * affine.y[2] - affine.y[1] * affine.x[2]) / determinant],
    y: [-affine.y[0] / determinant, affine.x[0] / determinant, (affine.y[0] * affine.x[2] - affine.x[0] * affine.y[2]) / determinant],
  }
}

function fitAffine(points: ReadonlyArray<{ imageCoordinate: Coordinate; targetCoordinate: Coordinate }>) {
  if (points.length < 3) return undefined
  const normal = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  const targetX = [0, 0, 0]
  const targetY = [0, 0, 0]
  for (const point of points) {
    const row = [point.imageCoordinate[0], point.imageCoordinate[1], 1]
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) normal[i]![j] += row[i]! * row[j]!
      targetX[i] += row[i]! * point.targetCoordinate[0]
      targetY[i] += row[i]! * point.targetCoordinate[1]
    }
  }
  const x = solve3(normal, targetX)
  const y = solve3(normal, targetY)
  return x && y ? { x, y } : undefined
}

function sourceScore(source: OfficialReferenceSource) {
  return source.capabilities.reduce((score, capability) => {
    if (PHYSICAL_ANCHOR_CAPABILITIES.has(capability)) return score + 10
    if (capability === 'target_parcel') return score + 3
    return score + 1
  }, 0)
}

function allCoordinatesAreFinite(points: TerritorialPreparationInput['controls']) {
  return points.every((point) => [...point.imageCoordinate, ...point.referenceCoordinate].every(Number.isFinite))
}

/** Scale-independent test that rejects coincident/collinear controls without imposing a metric accuracy threshold. */
function hasTwoDimensionalDistribution(points: readonly Coordinate[]) {
  if (points.length < 3) return false
  const mean = points.reduce(([sumX, sumY], [x, y]) => [sumX + x, sumY + y] as Coordinate, [0, 0] as Coordinate)
    .map((sum) => sum / points.length) as Coordinate
  let xx = 0
  let xy = 0
  let yy = 0
  for (const [x, y] of points) {
    const dx = x - mean[0]
    const dy = y - mean[1]
    xx += dx * dx
    xy += dx * dy
    yy += dy * dy
  }
  const trace = xx + yy
  const determinant = xx * yy - xy * xy
  return Number.isFinite(trace) && Number.isFinite(determinant) && trace > 0 && determinant / (trace * trace) > 1e-10
}

export function confirmTechnicianValidation(
  input: TerritorialPreparationInput,
  assessment: GeoreferencingAssessment,
  confirmation: TechnicianConfirmation,
): TechnicianConfirmedGeoreference {
  if (assessment.status === 'INVALID' || !assessment.transform || !assessment.metrics || !assessment.canTechnicianConfirm) {
    throw new Error('A structurally invalid georeference cannot be technician-confirmed')
  }
  if (!confirmation.reviewer.trim() || !confirmation.timestamp || !confirmation.purpose.trim()) {
    throw new Error('Reviewer, timestamp and validation purpose are required')
  }
  const inspected = confirmation.inspectedOverlay
    && confirmation.inspectedParcel
    && confirmation.inspectedControls
    && confirmation.inspectedResiduals
    && confirmation.confirmedSufficientForPurpose
  if (!inspected) throw new Error('Explicit inspection and confirmation of all spatial evidence is required')

  return {
    validationStatus: 'VALIDATED',
    validationMethod: 'TECHNICIAN_CONFIRMED',
    qualityStatus: assessment.status,
    qualityFlags: [...assessment.qualityFlags],
    automaticCriteriaWarning: assessment.status === 'REVIEW_REQUIRED'
      ? 'Technician confirmation was recorded despite one or more automatic quality warnings.'
      : undefined,
    reviewer: confirmation.reviewer.trim(),
    validatedAt: confirmation.timestamp,
    purpose: confirmation.purpose.trim(),
    transform: assessment.transform,
    metrics: assessment.metrics,
    source: {
      id: input.historicalCartography.id,
      sourceUrl: input.historicalCartography.sourceUrl,
      sourceHash: input.historicalCartography.sourceHash,
      format: input.historicalCartography.format,
      scaleDenominator: input.historicalCartography.scaleDenominator,
      pixelSpace: input.historicalCartography.pixelSpace,
    },
  }
}

export class TerritorialPreparationEngine {
  readonly policy: ValidationPolicy

  constructor(
    private readonly spatialReference: SpatialReferencePort,
    policy: Partial<ValidationPolicy> = {},
  ) {
    this.policy = {
      ...DEFAULT_POLICY,
      ...policy,
      automaticAcceptance: policy.automaticAcceptance,
    }
  }

  supportedTransformModels(): readonly TransformModel[] {
    // Additional fit adapters can add homography later without changing the source contracts.
    return ['affine']
  }

  availableCapabilities(input: TerritorialPreparationInput): ReferenceCapability[] {
    return [...new Set(input.referenceSources.filter((source) => source.official).flatMap((source) => source.capabilities))]
  }

  selectReferenceSources(input: TerritorialPreparationInput): OfficialReferenceSource[] {
    return [...input.referenceSources]
      .filter((source) => source.official && source.capabilities.length > 0)
      .sort((left, right) => sourceScore(right) - sourceScore(left) || left.id.localeCompare(right.id))
  }

  assess(input: TerritorialPreparationInput): GeoreferencingAssessment {
    const invalidReasons: string[] = []
    const invalid = (extraReasons: string[], transformResult?: AffineTransform, metrics?: GeoreferencingMetrics): GeoreferencingAssessment => ({
      transform: transformResult,
      metrics,
      status: 'INVALID',
      canAutomaticallyAccept: false,
      canTechnicianConfirm: false,
      canValidate: false,
      invalidReasons: [...new Set([...invalidReasons, ...extraReasons])],
      qualityFlags: [],
      reasons: [...new Set([...invalidReasons, ...extraReasons])],
    })

    if (input.controls.length < this.policy.minimumControlPoints) {
      invalidReasons.push(`At least ${this.policy.minimumControlPoints} control points are required`)
    }
    if (input.controls.length > this.policy.maximumControlPoints) {
      invalidReasons.push(`At most ${this.policy.maximumControlPoints} control points are allowed`)
    }
    if (!allCoordinatesAreFinite(input.controls)) invalidReasons.push('All control coordinates must be finite')
    if (invalidReasons.length > 0) return invalid([])

    const sources = new Map(input.referenceSources.map((source) => [source.id, source]))
    const normalized = input.controls.flatMap((point) => {
      const source = sources.get(point.referenceSourceId)
      if (!source) {
        invalidReasons.push(`Control ${point.id} references an unknown official source`)
        return []
      }
      if (!source.official) {
        invalidReasons.push(`Control ${point.id} does not use an official source`)
        return []
      }
      if (!source.capabilities.includes(point.capability)) {
        invalidReasons.push(`Control ${point.id} capability is not declared by ${source.id}`)
        return []
      }
      return [{ ...point, targetCoordinate: this.spatialReference.toTarget(point.referenceCoordinate, source.crs) }]
    })
    if (normalized.length < this.policy.minimumControlPoints) invalidReasons.push(`At least ${this.policy.minimumControlPoints} valid controls are required`)
    if (this.policy.requirePhysicalAnchor && !normalized.some((point) => PHYSICAL_ANCHOR_CAPABILITIES.has(point.capability))) {
      invalidReasons.push('At least one physical or cartographic anchor is required; thematic geometry alone is not enough')
    }
    if (!hasTwoDimensionalDistribution(normalized.map((point) => point.imageCoordinate))) {
      invalidReasons.push('Image control points do not have sufficient two-dimensional spatial distribution')
    }
    if (!hasTwoDimensionalDistribution(normalized.map((point) => point.targetCoordinate))) {
      invalidReasons.push('Reference control points do not have sufficient two-dimensional spatial distribution')
    }
    if (invalidReasons.length > 0) return invalid([])

    const coefficients = fitAffine(normalized)
    if (!coefficients) return invalid(['Control points are geometrically degenerate'])
    const transformResult: AffineTransform = {
      model: 'affine',
      sourcePixelSpace: input.historicalCartography.pixelSpace,
      targetCrs: this.spatialReference.targetCrs,
      ...coefficients,
      inverse: inverseAffine(coefficients),
    }
    if (!transformResult.inverse) return invalid(['The affine transformation is singular or non-invertible'], transformResult)

    const rawResiduals = normalized.map((point) => ({
      point,
      metres: this.spatialReference.distanceMetres(transform(point.imageCoordinate, transformResult), point.targetCoordinate),
    }))
    const rmsMetres = Math.sqrt(rawResiduals.reduce((sum, residual) => sum + residual.metres ** 2, 0) / rawResiduals.length)
    const residuals = rawResiduals.map((residual, index) => {
      const remaining = normalized.filter((_, candidate) => candidate !== index)
      const leaveOneOutFit = fitAffine(remaining)
      const leaveOneOutMetres = leaveOneOutFit
        ? this.spatialReference.distanceMetres(transform(residual.point.imageCoordinate, leaveOneOutFit), residual.point.targetCoordinate)
        : undefined
      const relevantResidual = Math.max(residual.metres, leaveOneOutMetres ?? 0)
      const exceedsAutomaticCriterion = this.policy.automaticAcceptance
        ? relevantResidual > this.policy.automaticAcceptance.maxResidualMetres
        : false
      return {
        pointId: residual.point.id,
        metres: residual.metres,
        leaveOneOutMetres,
        isOutlier: exceedsAutomaticCriterion,
        exceedsAutomaticCriterion,
      }
    })
    if (!Number.isFinite(rmsMetres) || residuals.some((residual) => !Number.isFinite(residual.metres) || (residual.leaveOneOutMetres !== undefined && !Number.isFinite(residual.leaveOneOutMetres)))) {
      return invalid(['Georeferencing metrics must be finite'], transformResult)
    }

    const qualityFlags: GeoreferencingQualityFlag[] = []
    if (!this.policy.automaticAcceptance) {
      qualityFlags.push('AUTOMATIC_CRITERIA_NOT_CONFIGURED')
    } else {
      if (rmsMetres > this.policy.automaticAcceptance.maxRmsMetres) qualityFlags.push('RMS_EXCEEDS_AUTOMATIC_CRITERION')
      if (residuals.some((residual) => residual.exceedsAutomaticCriterion)) qualityFlags.push('RESIDUAL_EXCEEDS_AUTOMATIC_CRITERION')
    }
    const status: GeoreferencingQualityStatus = qualityFlags.length === 0 ? 'AUTO_ACCEPTABLE' : 'REVIEW_REQUIRED'

    return {
      transform: transformResult,
      metrics: {
        metricCrs: this.spatialReference.metricCrs,
        rmsMetres,
        residuals,
        automaticResidualCriterionMetres: this.policy.automaticAcceptance?.maxResidualMetres,
      },
      status,
      canAutomaticallyAccept: status === 'AUTO_ACCEPTABLE',
      canTechnicianConfirm: true,
      canValidate: true,
      invalidReasons: [],
      qualityFlags,
      reasons: [],
    }
  }
}
