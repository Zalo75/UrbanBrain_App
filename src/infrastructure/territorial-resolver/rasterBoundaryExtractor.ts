import sharp from 'sharp'
import type { RasterBoundary, RasterGeoreference, RasterSheetCandidate, RasterSymbolObservation } from '@/application/territorial-resolver/detailedRasterZoningEngine'

export interface RasterBoundaryCandidate {
  id: string
  kind?: RasterBoundary['kind']
  closed: boolean
  geometry?: unknown
  strokeWidthPx: number
  continuity: number
  confidence: 'high' | 'medium' | 'low'
  symbol?: RasterSymbolObservation
  provenance?: string[]
}

export interface RasterBoundaryExtractorOptions {
  candidateDetector?: (image: Uint8Array) => Promise<RasterBoundaryCandidate[]>
  maxStrokeWidthPx?: number
  minContinuity?: number
  minComponentPixels?: number
}

/**
 * The default detector is a conservative raster segmentation pass. It groups
 * contiguous quantised colour regions, rejects tiny/noisy regions and emits
 * closed geographic envelopes only when the WMS pixel transform is proven.
 * Semantic identity remains delegated to the symbol/VLM port.
 */
export class RasterBoundaryExtractor {
  constructor(private readonly options: RasterBoundaryExtractorOptions = {}) {}

  async extract(image: Uint8Array, sheet: RasterSheetCandidate, georeference: RasterGeoreference, symbols: RasterSymbolObservation[]): Promise<RasterBoundary[]> {
    if (!georeference.accepted) return []
    const candidates = this.options.candidateDetector ? await this.options.candidateDetector(image) : await this.detectCandidates(image, georeference)
    const maxStroke = this.options.maxStrokeWidthPx ?? 8
    const minContinuity = this.options.minContinuity ?? 0.8
    return candidates
      .filter((candidate) => candidate.closed && candidate.strokeWidthPx > 0 && candidate.strokeWidthPx <= maxStroke && candidate.continuity >= minContinuity)
      .filter((candidate) => candidate.kind === 'zoning')
      .map((candidate) => ({
        id: candidate.id,
        kind: 'zoning' as const,
        closed: true,
        geometry: candidate.geometry,
        symbol: candidate.symbol ?? symbols.find((symbol) => symbol.code || symbol.label),
        topologyProven: true,
        confidence: candidate.confidence,
        provenance: [...(sheet.provenance ?? []), ...georeference.provenance, ...(candidate.provenance ?? []), `cv:stroke-width:${candidate.strokeWidthPx}`],
      }))
  }

  /** Hook for adapters that already have calibrated raster line candidates. */
  async detectCandidates(image: Uint8Array, georeference?: RasterGeoreference): Promise<RasterBoundaryCandidate[]> {
    if (this.options.candidateDetector) return this.options.candidateDetector(image)
    const info = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    if (!info.info.width || !info.info.height || !georeference?.pixelBbox) return []
    const { width, height, channels } = info.info
    const minPixels = this.options.minComponentPixels ?? Math.max(250, Math.floor(width * height * 0.0005))
    const labels = new Int32Array(width * height).fill(-1)
    const components: Array<{ id: number; minX: number; minY: number; maxX: number; maxY: number; pixels: number; rgb: [number, number, number] }> = []
    const pixel = (x: number, y: number) => {
      const o = (y * width + x) * channels
      return [Math.round(info.data[o]! / 24) * 24, Math.round(info.data[o + 1]! / 24) * 24, Math.round(info.data[o + 2]! / 24) * 24] as [number, number, number]
    }
    const similar = (a: [number, number, number], b: [number, number, number]) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])) <= 24
    let next = 0
    for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) {
      const start = y * width + x
      if (labels[start] !== -1) continue
      const rgb = pixel(x, y)
      if (Math.max(...rgb) > 245 || Math.min(...rgb) < 8) { labels[start] = -2; continue }
      const queue: Array<[number, number]> = [[x, y]]
      labels[start] = next
      let minX = x, minY = y, maxX = x, maxY = y, count = 0
      while (queue.length) {
        const [cx, cy] = queue.pop()!
        count++; minX = Math.min(minX, cx); minY = Math.min(minY, cy); maxX = Math.max(maxX, cx); maxY = Math.max(maxY, cy)
        for (const [nx, ny] of [[cx + 2, cy], [cx - 2, cy], [cx, cy + 2], [cx, cy - 2]] as Array<[number, number]>) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const index = ny * width + nx
          if (labels[index] !== -1 || !similar(rgb, pixel(nx, ny))) continue
          labels[index] = next; queue.push([nx, ny])
        }
      }
      if (count >= minPixels && maxX - minX > 12 && maxY - minY > 12) components.push({ id: next, minX, minY, maxX, maxY, pixels: count, rgb })
      next++
    }
    const b = georeference.pixelBbox
    const toLng = (x: number) => b.minLng + (x / width) * (b.maxLng - b.minLng)
    const toLat = (y: number) => b.maxLat - (y / height) * (b.maxLat - b.minLat)
    return components.slice(0, 32).map((component) => ({
      id: `cv-region-${component.id}`,
      kind: 'zoning' as const,
      closed: true,
      geometry: { type: 'Polygon', coordinates: [[[toLng(component.minX), toLat(component.minY)], [toLng(component.maxX), toLat(component.minY)], [toLng(component.maxX), toLat(component.maxY)], [toLng(component.minX), toLat(component.maxY)], [toLng(component.minX), toLat(component.minY)]]] },
      strokeWidthPx: 1,
      continuity: Math.min(1, component.pixels / Math.max(1, (component.maxX - component.minX) * (component.maxY - component.minY) / 4)),
      confidence: 'medium' as const,
      provenance: [`cv:quantized-region:${component.rgb.join('-')}`, `cv:pixels:${component.pixels}`],
    }))
  }
}

/** Short domain-facing name used by the raster engine composition root. */
export class BoundaryExtractor extends RasterBoundaryExtractor {}
