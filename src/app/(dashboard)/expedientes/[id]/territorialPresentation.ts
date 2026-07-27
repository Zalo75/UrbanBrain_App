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

export type UrbanContextAttention =
  | {
      kind: 'zone_pending'
      label: 'Zona urbanística pendiente'
      missing: ['zona urbanística u ordenanza aplicable']
    }
  | {
      kind: 'incomplete'
      label: 'Contexto urbanístico incompleto'
      missing: string[]
    }

export function getUrbanContextAttention({
  planning,
  zone,
  landClass,
}: {
  planning?: string | null
  zone?: string | null
  landClass?: string | null
}): UrbanContextAttention | null {
  const missing = [
    !planning?.trim() ? 'planeamiento' : null,
    !landClass?.trim() ? 'clasificación del suelo' : null,
    !zone?.trim() ? 'zona urbanística u ordenanza aplicable' : null,
  ].filter((item): item is string => item !== null)

  if (missing.length === 0) return null
  if (missing.length === 1 && missing[0] === 'zona urbanística u ordenanza aplicable') {
    return {
      kind: 'zone_pending',
      label: 'Zona urbanística pendiente',
      missing: ['zona urbanística u ordenanza aplicable'],
    }
  }

  return { kind: 'incomplete', label: 'Contexto urbanístico incompleto', missing }
}

export function buildTerritorialPresentation(
  stored: StoredLocation,
  detected: TerritorialContextView | null
) {
  const planning = detected ? detected.instrument : stored.planning ?? undefined
  const zone = detected
    ? detected.areas.join(', ') ||
      detected.manualContext?.ordinance?.trim() ||
      detected.manualContext?.area?.trim() ||
      undefined
    : stored.zone ?? undefined
  const landClass = detected
    ? detected.classification?.label
    : stored.landClass ?? undefined

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
    planning,
    zone,
    landClass,
    urbanContextAttention: getUrbanContextAttention({ planning, zone, landClass }),
  }
}
