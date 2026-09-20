import type { GeographicBbox } from '@/infrastructure/territorial-resolver/parcelMapOverlay'

export interface CartographicTransform {
  sourcePixelPivot: { x: number; y: number }
  targetPixelPivot: { x: number; y: number }
  rotationDegrees: number
  scaleX: number
  scaleY: number
}
export type CartographicViewArguments =
  | { operation: 'acquire'; representation: 'historical' | 'modern' | 'pair' | 'legend'; bbox: GeographicBbox; width: number; height: number }
  | { operation: 'render_alignment'; sourceViewId: string; referenceViewId: string; bbox: GeographicBbox; width: number; height: number; transform: CartographicTransform; opacity: number; phase: 'provisional' | 'freeze' }

const number = { type: 'number' } as const
const point = { type: 'object', properties: { x: number, y: number }, required: ['x', 'y'], additionalProperties: false } as const
const bbox = { type: 'object', properties: { minLat: number, minLng: number, maxLat: number, maxLng: number }, required: ['minLat', 'minLng', 'maxLat', 'maxLng'], additionalProperties: false } as const
const common = { bbox, width: { type: 'integer' }, height: { type: 'integer' } } as const
export const cartographicArgumentSchemas = [
  { type: 'object', properties: { operation: { type: 'string', enum: ['acquire'] }, representation: { type: 'string', enum: ['historical', 'modern', 'pair', 'legend'] }, ...common }, required: ['operation', 'representation', 'bbox', 'width', 'height'], additionalProperties: false },
  { type: 'object', properties: { operation: { type: 'string', enum: ['render_alignment'] }, sourceViewId: { type: 'string' }, referenceViewId: { type: 'string' }, ...common, transform: { type: 'object', properties: { sourcePixelPivot: point, targetPixelPivot: point, rotationDegrees: number, scaleX: number, scaleY: number }, required: ['sourcePixelPivot', 'targetPixelPivot', 'rotationDegrees', 'scaleX', 'scaleY'], additionalProperties: false }, opacity: number, phase: { type: 'string', enum: ['provisional', 'freeze'] } }, required: ['operation', 'sourceViewId', 'referenceViewId', 'bbox', 'width', 'height', 'transform', 'opacity', 'phase'], additionalProperties: false },
] as const

function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)) }
function keys(value: Record<string, unknown>, expected: string[]) { return Object.keys(value).length === expected.length && expected.every(key => key in value) }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function validPoint(value: unknown) { return record(value) && keys(value, ['x', 'y']) && finite(value.x) && finite(value.y) && Math.abs(value.x) <= 1e7 && Math.abs(value.y) <= 1e7 }
export function parseCartographicArguments(value: unknown): CartographicViewArguments | null {
  if (!record(value) || !record(value.bbox) || !keys(value.bbox, ['minLat', 'minLng', 'maxLat', 'maxLng'])) return null
  const b = value.bbox
  if (![b.minLat, b.minLng, b.maxLat, b.maxLng].every(finite)) return null
  const bounds = b as unknown as GeographicBbox
  if (bounds.minLat < -90 || bounds.maxLat > 90 || bounds.minLng < -180 || bounds.maxLng > 180 || bounds.minLat >= bounds.maxLat || bounds.minLng >= bounds.maxLng || bounds.maxLat - bounds.minLat > 2 || bounds.maxLng - bounds.minLng > 2) return null
  if (!Number.isInteger(value.width) || !Number.isInteger(value.height) || (value.width as number) < 64 || (value.height as number) < 64 || (value.width as number) > 1600 || (value.height as number) > 1600) return null
  if (value.operation === 'acquire' && keys(value, ['operation', 'representation', 'bbox', 'width', 'height']) && ['historical', 'modern', 'pair', 'legend'].includes(String(value.representation))) return value as unknown as CartographicViewArguments
  if (value.operation !== 'render_alignment' || !keys(value, ['operation', 'sourceViewId', 'referenceViewId', 'bbox', 'width', 'height', 'transform', 'opacity', 'phase'])) return null
  const t = value.transform
  if (!record(t) || !keys(t, ['sourcePixelPivot', 'targetPixelPivot', 'rotationDegrees', 'scaleX', 'scaleY']) || !validPoint(t.sourcePixelPivot) || !validPoint(t.targetPixelPivot) || !finite(t.rotationDegrees) || !finite(t.scaleX) || !finite(t.scaleY) || t.scaleX <= 0 || t.scaleY <= 0 || t.scaleX > 100 || t.scaleY > 100) return null
  if (![value.sourceViewId, value.referenceViewId].every(id => typeof id === 'string' && /^cartographic-view:[a-f0-9]{64}$/.test(id)) || !finite(value.opacity) || value.opacity < 0 || value.opacity > 1 || !['provisional', 'freeze'].includes(String(value.phase))) return null
  return value as unknown as CartographicViewArguments
}

export interface CartographicViewMetadata {
  id: string
  kind: 'historical' | 'modern' | 'legend' | 'overlay'
  provenanceKind: 'official_wms_view' | 'derived_alignment_overlay'
  expedienteId: string
  municipalityCode: string
  instrumentId: string
  sourceUrl: string | null
  layer: string | null
  style: string | null
  wmsVersion: '1.3.0' | '1.1.1' | null
  crs: 'EPSG:4326'
  bbox: GeographicBbox
  spatialFrameApplicable: boolean
  requestedDimensions: { width: number; height: number }
  axisOrder: 'latitude,longitude'
  width: number
  height: number
  queriedAt: string
  checksum: string
  pixelConvention: 'top-left; x right; y down; pixel centres 0..width-1,0..height-1'
  parentViewIds: string[]
  alignment?: { id: string; phase: 'provisional' | 'freeze'; referenceViewId: string; sourceViewId: string; transform: CartographicTransform; opacity: number }
}
export interface CartographicToolResult {
  toolName: 'get_cartographic_view'
  status: 'available' | 'unavailable' | 'error'
  views: CartographicViewMetadata[]
  limitations: string[]
}
export function cartographicToolLimit() {
  const configured = Number(process.env.URBANBRAIN_ACCREDITED_CARTOGRAPHIC_MAX_TOOL_CALLS ?? 12)
  return Number.isInteger(configured) && configured >= 4 && configured <= 16 ? configured : 12
}
