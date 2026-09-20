import type { TerritorialResolution } from '@/domain/territorial-resolver/types'
import type { TerritorialDetectionSummary } from './normalizeParcelContext'
import { detectionSummary } from './detectionSummary'

/** Versioned writes are authoritative. Only historical rows need reconciliation
 * with the detector envelope; this boundary is shared by UI and chat loaders. */
export function rehydrateDetectionSummary(stored: TerritorialDetectionSummary | null, raw: unknown): TerritorialDetectionSummary | null {
  if (stored?.schemaVersion === 1) return stored
  const result = raw as TerritorialResolution | undefined
  if (!result?.resolvedAt || !Array.isArray(result.evidence) || !Array.isArray(result.warnings) || !Array.isArray(result.conflicts) || !Array.isArray(result.planning?.evidence) || !Array.isArray(result.affects?.detected)) return stored
  const derived = detectionSummary(result)
  const summary = { ...derived, ...Object.fromEntries(Object.entries(stored ?? {}).filter(([, value]) => value !== undefined && value !== null)) }
  const explicitOperationalValue = derived.classificationResolution?.finalSelection?.operationalValue?.trim()
  const storedClassification = stored?.landClass?.trim() || stored?.manualContext?.classification?.trim()
  const classificationConflict = Boolean(explicitOperationalValue && storedClassification && explicitOperationalValue.toLocaleLowerCase() !== storedClassification.toLocaleLowerCase())
  if (classificationConflict) {
    summary.landClass = undefined
    summary.automaticLandClass = undefined
    summary.classificationDetermination = undefined
    summary.unknownReasons = {
      ...(summary.unknownReasons ?? {}),
      classification: 'Conflicting explicit historical classification values; reconciliation is required.',
    }
  }
  // An official fallback is not allowed to overwrite an explicit technician field.
  const rawTechnician = derived.classificationDetermination?.technician
  const storedTechnician = stored?.classificationDetermination?.technician
  if (!classificationConflict && rawTechnician && (!storedTechnician || (rawTechnician.recordedAt ?? '') >= (storedTechnician.recordedAt ?? ''))) {
    summary.classificationDetermination = derived.classificationDetermination
    summary.landClass = rawTechnician.value
    summary.urbanisticFacts = derived.urbanisticFacts
  }
  summary.manualContext = stored?.manualContext ?? derived.manualContext
  summary.actionAreaSelection = stored?.actionAreaSelection ?? derived.actionAreaSelection
  const selection = summary.actionAreaSelection?.current
  const repaired = derived.actionAreaSelection?.current
  if (selection && repaired && selection.id === repaired.id && !(selection.surfaceSquareMetres > 0)) summary.actionAreaSelection = derived.actionAreaSelection
  summary.coverage = derived.coverage
  summary.parcelSurfaceSquareMetres = derived.parcelSurfaceSquareMetres ?? stored?.parcelSurfaceSquareMetres
  return summary
}
