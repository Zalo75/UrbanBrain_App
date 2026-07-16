import type { TerritorialContextView } from '@/application/territorial-resolver/territorialContextView'

interface StoredLocation {
  province: string
  municipality: string
  address?: string | null
  lat?: number | null
  lng?: number | null
  planning?: string | null
  zone?: string | null
  landClass?: string | null
}

export function buildTerritorialPresentation(
  stored: StoredLocation,
  detected: TerritorialContextView | null
) {
  return {
    province: detected?.province ?? stored.province,
    municipality: detected?.municipality ?? stored.municipality,
    address: detected?.address ?? stored.address ?? null,
    coordinates: detected?.coordinates ??
      (stored.lat !== null && stored.lat !== undefined &&
      stored.lng !== null && stored.lng !== undefined
        ? { lat: stored.lat, lng: stored.lng }
        : undefined),
    technicallyReviewed: detected?.technicallyReviewed === true,
    planning: detected ? detected.instrument : stored.planning ?? undefined,
    zone: detected ? detected.areas.join(', ') || undefined : stored.zone ?? undefined,
    landClass: detected
      ? detected.classification?.label
      : stored.landClass ?? undefined,
  }
}
