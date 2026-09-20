import sharp from 'sharp'
import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai'
import type { TerritorialConfidence } from '@/domain/territorial-resolver/types'
import type { RasterSymbolObservation } from '@/application/territorial-resolver/detailedRasterZoningEngine'

export interface RasterRoi {
  id: string
  bbox: [number, number, number, number]
  image: Uint8Array
  kind: 'text' | 'circle' | 'box'
  confidence: TerritorialConfidence
  provenance: string[]
}

export interface RasterSymbolVlmRequest {
  roi: Uint8Array
  legend?: Uint8Array
  sheetId: string
  instrumentId: string
}

export interface RasterSymbolVlmResult {
  code?: string
  label?: string
  confidence: TerritorialConfidence
  rawEvidence?: string
}

export interface RasterSymbolVlm {
  interpret(request: RasterSymbolVlmRequest): Promise<RasterSymbolVlmResult | null>
}

export interface RasterSymbolDetectorOptions {
  vlm?: RasterSymbolVlm
  legend?: Uint8Array
  maxRois?: number
}

type Component = { minX: number; minY: number; maxX: number; maxY: number; pixels: number }

/**
 * Conservative CV front-end. It only proposes compact dark connected regions;
 * semantic identity is delegated to the injected VLM and never inferred here.
 */
export class RasterSymbolDetector {
  constructor(private readonly options: RasterSymbolDetectorOptions = {}) {}

  async detect(image: Uint8Array, sheetId: string, instrumentId: string): Promise<RasterSymbolObservation[]> {
    const rois = await this.detectRois(image)
    const observations: RasterSymbolObservation[] = []
    for (const roi of rois) {
      const result = this.options.vlm ? await this.options.vlm.interpret({ roi: roi.image, legend: this.options.legend, sheetId, instrumentId }) : null
      observations.push({
        code: result?.code,
        label: result?.label,
        bbox: roi.bbox,
        confidence: result?.confidence ?? 'low',
        sourceSymbol: result?.rawEvidence ? `${roi.id}:${result.rawEvidence}` : roi.id,
        rawEvidence: result?.rawEvidence,
        legendMatch: Boolean(result?.code || result?.label) && Boolean(this.options.legend),
        provenance: [...roi.provenance, ...(result?.rawEvidence ? [`vlm:${result.rawEvidence}`] : [])],
      })
    }
    return observations
  }

  async detectRois(image: Uint8Array): Promise<RasterRoi[]> {
    const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const width = info.width
    const height = info.height
    const visited = new Uint8Array(width * height)
    const components: Component[] = []
    const isInk = (x: number, y: number) => {
      const offset = (y * width + x) * info.channels
      const luminance = (data[offset] * 299 + data[offset + 1] * 587 + data[offset + 2] * 114) / 1000
      return luminance < 120 && data[offset + 3] > 20
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const index = y * width + x
      if (visited[index] || !isInk(x, y)) continue
      const queue: [number, number][] = [[x, y]]
      visited[index] = 1
      let minX = x, maxX = x, minY = y, maxY = y, pixels = 0
      while (queue.length) {
        const [cx, cy] = queue.pop()!
        pixels++
        minX = Math.min(minX, cx); maxX = Math.max(maxX, cx); minY = Math.min(minY, cy); maxY = Math.max(maxY, cy)
        for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]] as [number, number][]) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const ni = ny * width + nx
          if (!visited[ni] && isInk(nx, ny)) { visited[ni] = 1; queue.push([nx, ny]) }
        }
      }
      const area = (maxX - minX + 1) * (maxY - minY + 1)
      if (pixels >= 8 && area <= width * height * 0.15 && maxX - minX >= 2 && maxY - minY >= 2) components.push({ minX, minY, maxX, maxY, pixels })
    }
    components.sort((a, b) => b.pixels - a.pixels)
    const max = this.options.maxRois ?? 24
    const rois: RasterRoi[] = []
    if (components.length === 0) return rois
    for (const [index, component] of components.slice(0, max).entries()) {
      const left = Math.max(0, component.minX - 3)
      const top = Math.max(0, component.minY - 3)
      const widthRoi = Math.min(width - left, component.maxX - component.minX + 7)
      const heightRoi = Math.min(height - top, component.maxY - component.minY + 7)
      const crop = await sharp(image).extract({ left, top, width: widthRoi, height: heightRoi }).png().toBuffer()
      const aspect = widthRoi / heightRoi
      rois.push({ id: `roi-${index + 1}`, bbox: [left, top, left + widthRoi, top + heightRoi], image: crop, kind: aspect > 1.8 ? 'text' : aspect < 0.55 ? 'box' : 'circle', confidence: 'medium', provenance: [`cv:connected-component:${index + 1}`] })
    }
    return rois
  }
}

/** Short domain-facing name used by the raster engine composition root. */
export class SymbolDetector extends RasterSymbolDetector {}

/** Provider-agnostic Gemini Flash implementation. It receives only ROI/legend. */
export class GeminiRasterSymbolVlm implements RasterSymbolVlm {
  private readonly model: GenerativeModel
  constructor(apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY, modelName = process.env.URBANBRAIN_DETAILED_ZONING_GEMINI_MODEL ?? 'gemini-2.5-flash') {
    if (!apiKey) throw new Error('Gemini visual provider requires GEMINI_API_KEY or GOOGLE_API_KEY')
    this.model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: modelName })
  }

  async interpret(request: RasterSymbolVlmRequest): Promise<RasterSymbolVlmResult | null> {
    const content: Array<string | { text: string } | { inlineData: { mimeType: string; data: string } }> = [{ text: 'Identify only a zoning code/label in this marked ROI. Return JSON {code,label,confidence,rawEvidence}; never infer an ordinance.' }, { inlineData: { mimeType: 'image/png', data: Buffer.from(request.roi).toString('base64') } }]
    if (request.legend) content.push({ inlineData: { mimeType: 'image/png', data: Buffer.from(request.legend).toString('base64') } })
    const response = await this.model.generateContent(content)
    const text = response.response.text().trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim()
    try {
      const parsed = JSON.parse(text) as Partial<RasterSymbolVlmResult>
      return { code: parsed.code?.trim() || undefined, label: parsed.label?.trim() || undefined, confidence: parsed.confidence === 'high' || parsed.confidence === 'medium' ? parsed.confidence : 'low', rawEvidence: parsed.rawEvidence }
    } catch {
      return null
    }
  }
}
