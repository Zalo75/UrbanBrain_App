import type { PlanningDocumentReference, TerritorialCoordinates } from '@/domain/territorial-resolver/types'

export interface TileIndexFeature {
  id?: string
  gid?: string
  filename?: string
  location?: string
  folder?: string
  instrumentId: string
  extent?: { minLat: number; minLng: number; maxLat: number; maxLng: number }
}

export interface OriginalSheetCandidate {
  document: PlanningDocumentReference
  match: 'extent' | 'metadata' | 'unresolved'
  projectedPoint?: { x: number; y: number }
}

function metadataExtent(document: PlanningDocumentReference) {
  const metadata = (document as PlanningDocumentReference & { metadata?: unknown }).metadata
  if (!metadata || typeof metadata !== 'object') return undefined
  const value = metadata as Record<string, unknown>
  const numbers = ['minLat', 'minLng', 'maxLat', 'maxLng'].map((key) => value[key])
  return numbers.every((item) => typeof item === 'number')
    ? { minLat: numbers[0] as number, minLng: numbers[1] as number, maxLat: numbers[2] as number, maxLng: numbers[3] as number }
    : undefined
}

function contains(extent: TileIndexFeature['extent'], point: TerritorialCoordinates) {
  return Boolean(extent && point.lat >= extent.minLat && point.lat <= extent.maxLat && point.lng >= extent.minLng && point.lng <= extent.maxLng)
}

function projection(extent: TileIndexFeature['extent'], point: TerritorialCoordinates) {
  if (!extent || !contains(extent, point)) return undefined
  return {
    x: (point.lng - extent.minLng) / (extent.maxLng - extent.minLng),
    y: (extent.maxLat - point.lat) / (extent.maxLat - extent.minLat),
  }
}

export function selectOriginalPlanningSheets(input: {
  feature: TileIndexFeature
  documents: PlanningDocumentReference[]
  point: TerritorialCoordinates
}): OriginalSheetCandidate[] {
  const documents = input.documents.filter((document) =>
    document.instrumentId === input.feature.instrumentId &&
    (document.documentType === 'sheet' || /(?:sheet|plano|calific|ordenaci[oó]n)/i.test(document.title))
  )
  const byMetadata = documents
    .map((document) => ({ document, extent: metadataExtent(document) }))
    .filter((item): item is { document: PlanningDocumentReference; extent: NonNullable<ReturnType<typeof metadataExtent>> } => Boolean(item.extent))
    .filter((item) => contains(item.extent, input.point))
    .map((item) => ({ document: item.document, match: 'metadata' as const, projectedPoint: projection(item.extent, input.point) }))
  if (byMetadata.length > 0) return byMetadata
  return documents.map((document) => ({ document, match: 'unresolved' as const }))
}
