import sharp from 'sharp'
import { fitAffineRansac, type RasterTiePoint, type SpatialRegistrationControl } from './contentDrivenSheetMatcher'

export interface RasterTiePointExtraction {
  tiePoints: RasterTiePoint[]
  provenance: string[]
  roiCount: number
  vlmExecuted: boolean
  rmsMetres?: number
  topologyScore?: number
  stabilityScore?: number
}

type Point = [number, number]

function cross(o: Point, a: Point, b: Point) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]) }
function convexHull(points: Point[]) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]); if (sorted.length < 3) return sorted
  const lower: Point[] = []; for (const point of sorted) { while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0) lower.pop(); lower.push(point) }
  const upper: Point[] = []; for (const point of [...sorted].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0) upper.pop(); upper.push(point) }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

export function douglasPeucker(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points
  const first = points[0]!; const last = points[points.length - 1]!; let maxDistance = 0; let index = 0
  for (let i = 1; i < points.length - 1; i += 1) { const distance = Math.abs(cross(first, last, points[i]!)) / Math.max(1e-9, Math.hypot(last[0] - first[0], last[1] - first[1])); if (distance > maxDistance) { maxDistance = distance; index = i } }
  if (maxDistance <= epsilon) return [first, last]
  const left = douglasPeucker(points.slice(0, index + 1), epsilon); const right = douglasPeucker(points.slice(index), epsilon)
  return [...left.slice(0, -1), ...right]
}

function normalize(points: Point[]) {
  const minX = Math.min(...points.map((p) => p[0])); const maxX = Math.max(...points.map((p) => p[0])); const minY = Math.min(...points.map((p) => p[1])); const maxY = Math.max(...points.map((p) => p[1]))
  return points.map(([x, y]) => [(x - minX) / Math.max(1e-9, maxX - minX), (y - minY) / Math.max(1e-9, maxY - minY)] as Point)
}

function resample(points: Point[], count: number) {
  const closed = [...points, points[0]!]; const lengths = closed.slice(1).map((p, i) => Math.hypot(p[0] - closed[i]![0], p[1] - closed[i]![1])); const total = lengths.reduce((a, b) => a + b, 0); const result: Point[] = []
  for (let n = 0; n < count; n += 1) { let target = total * n / count; let index = 0; while (target > lengths[index]! && index < lengths.length - 1) { target -= lengths[index]!; index += 1 } const a = closed[index]!; const b = closed[index + 1]!; const t = lengths[index]! ? target / lengths[index]! : 0; result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]) }
  return result
}

function shapeDistance(a: Point[], b: Point[]) {
  let best = Infinity
  for (const reverse of [false, true]) for (let shift = 0; shift < b.length; shift += 1) { let total = 0; for (let i = 0; i < a.length; i += 1) { const j = reverse ? (shift - i + b.length * 2) % b.length : (shift + i) % b.length; total += Math.hypot(a[i]![0] - b[j]![0], a[i]![1] - b[j]![1]) } best = Math.min(best, total / a.length) }
  return best
}

async function rasterFootprint(image: Uint8Array): Promise<{ points: Point[]; width: number; height: number }> {
  const decoded = await sharp(image).resize({ width: 512, withoutEnlargement: true }).grayscale().raw().toBuffer({ resolveWithObject: true }); const { width, height } = decoded.info
  const dark = new Uint8Array(width * height); const index = (x: number, y: number) => y * width + x
  for (let y = 4; y < height - 4; y += 1) for (let x = 4; x < Math.floor(width * 0.84); x += 1) {
    const value = decoded.data[index(x, y)]!; if (value >= 105) continue
    let neighbours = 0
    for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) if (dx || dy) neighbours += (decoded.data[index(Math.max(0, Math.min(width - 1, x + dx)), Math.max(0, Math.min(height - 1, y + dy)))]! < 145 ? 1 : 0)
    // Thin isolated text/contours are discarded; continuous urban limits
    // survive this local stroke-width/continuity gate.
    if (neighbours >= 4) dark[index(x, y)] = 1
  }
  // Close short gaps in dashed limits before connected-component analysis.
  for (let pass = 0; pass < 2; pass += 1) {
    const copy = dark.slice()
    for (let y = 2; y < height - 2; y += 1) for (let x = 2; x < Math.floor(width * 0.84); x += 1) {
      if (copy[index(x, y)]) continue
      let neighbours = 0; for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) neighbours += copy[index(x + dx, y + dy)] ?? 0
      if (neighbours >= 5) dark[index(x, y)] = 1
    }
  }
  const visited = new Uint8Array(width * height); const components: Point[][] = []
  for (let y = 4; y < height - 4; y += 1) for (let x = 4; x < Math.floor(width * 0.84); x += 1) {
    const start = index(x, y); if (!dark[start] || visited[start]) continue
    const queue: Point[] = [[x, y]]; visited[start] = 1; const component: Point[] = []
    while (queue.length) { const [cx, cy] = queue.pop()!; component.push([cx, cy]); for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]] as Point[]) { if (nx < 1 || ny < 1 || nx >= width - 1 || ny >= height - 1) continue; const next = index(nx, ny); if (dark[next] && !visited[next]) { visited[next] = 1; queue.push([nx, ny]) } } }
    if (component.length >= width * height * 0.00008) components.push(component)
  }
  const points = components.sort((a, b) => b.length - a.length).slice(0, 6).flatMap((component) => convexHull(component))
  return { points: douglasPeucker(convexHull(points), 2), width, height }
}

export class RasterTiePointExtractor {
  constructor(private readonly maxControlVertices = 32) {}

  async extract(image: Uint8Array, controls: SpatialRegistrationControl[]): Promise<RasterTiePointExtraction> {
    const control = controls.find((candidate) => (candidate.coordinates?.length ?? 0) >= 3); if (!control?.coordinates) return { tiePoints: [], provenance: ['tie-points:no-vector-control'], roiCount: 0, vlmExecuted: false }
    const footprint = await rasterFootprint(image); if (footprint.points.length < 3) return { tiePoints: [], provenance: ['tie-points:no-raster-footprint'], roiCount: 0, vlmExecuted: false }
    const rasterShape = resample(normalize(footprint.points), this.maxControlVertices); const vectorShape = resample(normalize(control.coordinates.map(([lng, lat]) => [lng, lat])), this.maxControlVertices); const distance = shapeDistance(rasterShape, vectorShape); const topologyScore = Math.max(0, 1 - distance)
    const vector = resample(control.coordinates.map(([lng, lat]) => [lng, lat]), this.maxControlVertices); const pixel = resample(footprint.points, this.maxControlVertices)
    const tiePoints: RasterTiePoint[] = pixel.map((point, index) => ({ pixel: [point[0] * (512 / Math.max(1, footprint.width)), point[1] * (512 / Math.max(1, footprint.height))], coordinate: vector[index]! }))
    const fit = fitAffineRansac(tiePoints)
    return { tiePoints, provenance: ['tie-points:cv-footprint', 'tie-points:douglas-peucker', 'tie-points:shape-match:procrustes-hull', 'tie-points:anchors:vertices-corners', 'tie-points:ransac'], roiCount: 0, vlmExecuted: false, rmsMetres: fit?.rmsMetres, topologyScore, stabilityScore: fit ? 1 : 0 }
  }
}
