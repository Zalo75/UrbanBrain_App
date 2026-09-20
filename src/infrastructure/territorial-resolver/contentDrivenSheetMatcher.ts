import type { RasterSheetCandidate } from '@/application/territorial-resolver/detailedRasterZoningEngine'

export interface SpatialRegistrationControl { id: string; geometry: unknown; source: '3CLAS' | '1DEL'; coordinates?: Array<[number, number]> }
export interface RasterTiePoint { pixel: [number, number]; coordinate: [number, number] }
export interface SpatialSheetMatch { sheetId: string; accepted: boolean; transform?: 'affine-least-squares'; rmsMetres?: number; topologyScore?: number; bbox?: { minLat: number; minLng: number; maxLat: number; maxLng: number }; reason: string; provenance: string[] }

function solve3x3(matrix: number[][], vector: number[]) {
  const a = matrix.map((row, index) => [...row, vector[index]!])
  for (let column = 0; column < 3; column += 1) {
    let pivot = column
    for (let row = column + 1; row < 3; row += 1) if (Math.abs(a[row]![column]!) > Math.abs(a[pivot]![column]!)) pivot = row
    if (Math.abs(a[pivot]![column]!) < 1e-12) return undefined
    ;[a[column], a[pivot]] = [a[pivot]!, a[column]!]
    const divisor = a[column]![column]!
    for (let index = column; index <= 3; index += 1) a[column]![index] = a[column]![index]! / divisor
    for (let row = 0; row < 3; row += 1) {
      if (row === column) continue
      const factor = a[row]![column]!
      for (let index = column; index <= 3; index += 1) a[row]![index] = a[row]![index]! - factor * a[column]![index]!
    }
  }
  return [a[0]![3]!, a[1]![3]!, a[2]![3]!]
}

export function fitAffineLeastSquares(points: RasterTiePoint[]) {
  if (points.length < 3) return undefined
  const normal = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; const xVector = [0, 0, 0]; const yVector = [0, 0, 0]
  for (const point of points) {
    const row = [point.pixel[0], point.pixel[1], 1]
    for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) normal[i]![j] += row[i]! * row[j]!
    for (let i = 0; i < 3; i += 1) { xVector[i] += row[i]! * point.coordinate[0]; yVector[i] += row[i]! * point.coordinate[1] }
  }
  const x = solve3x3(normal, xVector); const y = solve3x3(normal, yVector); if (!x || !y) return undefined
  let squared = 0
  for (const point of points) {
    const predicted: [number, number] = [x[0]! * point.pixel[0] + x[1]! * point.pixel[1] + x[2]!, y[0]! * point.pixel[0] + y[1]! * point.pixel[1] + y[2]!]
    const dx = (predicted[0] - point.coordinate[0]) * 111_320 * Math.cos(point.coordinate[1] * Math.PI / 180); const dy = (predicted[1] - point.coordinate[1]) * 111_320
    squared += dx * dx + dy * dy
  }
  const rmsMetres = Math.sqrt(squared / points.length)
  const inliers = points.filter((point) => {
    const predicted: [number, number] = [x[0]! * point.pixel[0] + x[1]! * point.pixel[1] + x[2]!, y[0]! * point.pixel[0] + y[1]! * point.pixel[1] + y[2]!]
    const dx = (predicted[0] - point.coordinate[0]) * 111_320 * Math.cos(point.coordinate[1] * Math.PI / 180); const dy = (predicted[1] - point.coordinate[1]) * 111_320
    return Math.hypot(dx, dy) <= 5
  }).length
  return { coefficients: { x, y }, rmsMetres, inlierRatio: inliers / points.length }
}

export function fitAffineRansac(points: RasterTiePoint[], maxIterations = 200) {
  if (points.length < 3) return undefined
  let best: { fit: ReturnType<typeof fitAffineLeastSquares>; inliers: RasterTiePoint[] } | undefined
  let iteration = 0
  for (let a = 0; a < points.length - 2 && iteration < maxIterations; a += 1) for (let b = a + 1; b < points.length - 1 && iteration < maxIterations; b += 1) for (let c = b + 1; c < points.length && iteration < maxIterations; c += 1) {
    iteration += 1; const fit = fitAffineLeastSquares([points[a]!, points[b]!, points[c]!]); if (!fit) continue
    const inliers = points.filter((point) => { const predicted: [number, number] = [fit.coefficients.x[0]! * point.pixel[0] + fit.coefficients.x[1]! * point.pixel[1] + fit.coefficients.x[2]!, fit.coefficients.y[0]! * point.pixel[0] + fit.coefficients.y[1]! * point.pixel[1] + fit.coefficients.y[2]!]; const dx = (predicted[0] - point.coordinate[0]) * 111_320 * Math.cos(point.coordinate[1] * Math.PI / 180); const dy = (predicted[1] - point.coordinate[1]) * 111_320; return Math.hypot(dx, dy) <= 5 })
    if (!best || inliers.length > best.inliers.length) best = { fit, inliers }
  }
  if (!best || best.inliers.length < 3) return undefined
  return fitAffineLeastSquares(best.inliers)
}

/** Scale/dimensions are never a spatial extent. Registration requires explicit raster tie-points. */
export function matchSheetToOfficialControls(sheet: RasterSheetCandidate, controls: SpatialRegistrationControl[], options: { tiePoints?: RasterTiePoint[]; topologyScore?: number; maxRmsMetres?: number } = {}): SpatialSheetMatch {
  const provenance = [...sheet.provenance, `spatial-registration:controls=${controls.length}`]
  if (controls.length === 0) return { sheetId: sheet.id, accepted: false, reason: 'NO_OFFICIAL_3CLAS_OR_1DEL_CONTROLS', provenance }
  if (!options.tiePoints || options.tiePoints.length < 3) return { sheetId: sheet.id, accepted: false, reason: 'NO_RASTER_TIE_POINTS', provenance: [...provenance, 'spatial-registration:rejected:no-tie-points'] }
  const fit = fitAffineRansac(options.tiePoints); if (!fit) return { sheetId: sheet.id, accepted: false, reason: 'AFFINE_RANSAC_FAILED', provenance }
  const topologyScore = options.topologyScore ?? fit.inlierRatio; const accepted = fit.rmsMetres <= (options.maxRmsMetres ?? 5) && topologyScore >= 0.95
  return { sheetId: sheet.id, accepted, transform: 'affine-least-squares', rmsMetres: fit.rmsMetres, topologyScore, reason: accepted ? 'OFFICIAL_CONTROL_AFFINE_AND_TOPOLOGY_MATCH' : 'AFFINE_OR_TOPOLOGY_THRESHOLD_FAILED', provenance: [...provenance, `spatial-registration:rms-m=${fit.rmsMetres.toFixed(3)}`, `spatial-registration:topology=${topologyScore.toFixed(4)}`] }
}

export function selectUniqueSpatialMatch(matches: SpatialSheetMatch[], minimumScoreMargin = 0.03) {
  const ranked = matches.filter((match) => match.accepted).sort((a, b) => (b.topologyScore ?? 0) - (a.topologyScore ?? 0) || (a.rmsMetres ?? Infinity) - (b.rmsMetres ?? Infinity)); const first = ranked[0]; const second = ranked[1]
  if (!first || (second && (first.topologyScore ?? 0) - (second.topologyScore ?? 0) < minimumScoreMargin)) return undefined
  return first
}
