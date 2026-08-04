import type {
  ActionAreaSelection,
  ActionAreaSelectionSnapshot,
  ActionAreaSelectionState,
  AffectApplicability,
  ClassificationCandidate,
  DeterminationVerification,
  ParcelGeometry,
  TerritorialResolution,
  UrbanisticRegimeFacts,
} from '@/domain/territorial-resolver/types'

function snapshot(selection: ActionAreaSelection): ActionAreaSelectionSnapshot {
  const value = { ...selection }
  delete value.previousSnapshot
  return value
}

function appendCurrentToHistory(state?: ActionAreaSelectionState) {
  return state?.current
    ? [...state.history, snapshot(state.current)]
    : [...(state?.history ?? [])]
}

export function createDetectedZoneActionArea(input: {
  candidate: ClassificationCandidate
  selectedBy: string
  selectedAt: string
  verification: DeterminationVerification
  affects?: AffectApplicability
  previous?: ActionAreaSelectionState
}): ActionAreaSelectionState | undefined {
  const coverage = input.candidate.parcelCoverage
  if (!coverage?.intersectionGeometry || coverage.intersectionAreaSquareMetres <= 0) {
    return undefined
  }
  const planningZones = [...new Set(input.candidate.areas.map((area) => area.name.trim()).filter(Boolean))]
  const previousSnapshot = input.previous?.current
    ? snapshot(input.previous.current)
    : undefined
  const current: ActionAreaSelection = {
    id: crypto.randomUUID(),
    geometry: coverage.intersectionGeometry,
    surfaceSquareMetres: coverage.intersectionAreaSquareMetres,
    parcelSurfaceSquareMetres: coverage.parcelAreaSquareMetres,
    selectionType: 'detected_zone',
    selectedCandidateId: input.candidate.id,
    classification: input.candidate.kind === 'official_classification' ? input.candidate.classification.code : 'ND',
    category: input.candidate.kind === 'official_classification' ? input.candidate.classification.categoryCode : undefined,
    planningZone: planningZones.length === 1 ? planningZones[0] : undefined,
    planningZones,
    source: input.candidate.source,
    confidence: input.candidate.confidence,
    selectedBy: input.selectedBy,
    selectedAt: input.selectedAt,
    verification: input.verification,
    affects: input.affects,
    previousSnapshot,
  }
  return {
    current,
    history: appendCurrentToHistory(input.previous),
  }
}

export function createWholeParcelActionArea(input: {
  geometry: ParcelGeometry
  surfaceSquareMetres: number
  selectedBy: string
  selectedAt: string
  verification: DeterminationVerification
  affects: AffectApplicability
  previous?: ActionAreaSelectionState
}): ActionAreaSelectionState {
  const previousSnapshot = input.previous?.current
    ? snapshot(input.previous.current)
    : undefined
  return {
    current: {
      id: crypto.randomUUID(),
      geometry: input.geometry,
      surfaceSquareMetres: input.surfaceSquareMetres,
      parcelSurfaceSquareMetres: input.surfaceSquareMetres,
      selectionType: 'whole_parcel',
      source: 'catastro',
      confidence: 'high',
      selectedBy: input.selectedBy,
      selectedAt: input.selectedAt,
      verification: input.verification,
      affects: input.affects,
      previousSnapshot,
    },
    history: appendCurrentToHistory(input.previous),
  }
}

export function revokeActionAreaSelection(
  previous: ActionAreaSelectionState | undefined,
  revokedBy: string,
  revokedAt: string
): ActionAreaSelectionState {
  return {
    history: appendCurrentToHistory(previous),
    revokedAt,
    revokedBy,
  }
}

function selectedCandidate(
  resolution: TerritorialResolution | undefined,
  selection?: ActionAreaSelection
) {
  if (!selection?.selectedCandidateId) return undefined
  return resolution?.planning.classificationResolution?.candidates.find(
    (candidate) => candidate.id === selection.selectedCandidateId
  )
}

export function applyActionAreaToUrbanisticFacts(
  automatic: UrbanisticRegimeFacts,
  resolution: TerritorialResolution | undefined,
  selection?: ActionAreaSelection
): UrbanisticRegimeFacts {
  if (
    !selection ||
    selection.selectionType !== 'detected_zone' ||
    !selection.classification
  ) return automatic
  const candidate = selectedCandidate(resolution, selection)
  const status = selection.verification === 'technician_validated'
    ? 'technician_validated' as const
    : 'manual_review_required' as const
  const confidence = selection.verification === 'technician_validated'
    ? 'high' as const
    : candidate?.confidence ?? selection.confidence
  return {
    ...automatic,
    classification: {
      ...automatic.classification,
      value: {
        code: selection.classification,
        label: candidate?.kind === 'official_classification' ? (candidate.classification.label ?? selection.classification) : selection.classification,
      },
      label: candidate?.kind === 'official_classification' ? (candidate.classification.label ?? selection.classification) : selection.classification,
      status,
      confidence,
      origin: 'technician_selection',
      evidence: candidate?.evidence ?? automatic.classification.evidence,
      discrepancies: [],
      warnings: [...automatic.classification.warnings],
      nextAction: selection.verification === 'technician_validated' ? 'none' : 'manual_selection',
    },
    category: selection.category
      ? {
          ...automatic.category,
          value: {
            code: selection.category,
            label: candidate?.kind === 'official_classification' ? (candidate.classification.categoryLabel ?? selection.category) : selection.category,
          },
          label: candidate?.kind === 'official_classification' ? (candidate.classification.categoryLabel ?? selection.category) : selection.category,
          status,
          confidence,
          origin: 'technician_selection',
          evidence: candidate?.evidence ?? automatic.category.evidence,
          discrepancies: [],
          warnings: [...automatic.category.warnings],
          nextAction: selection.verification === 'technician_validated' ? 'none' : 'manual_selection',
        }
      : {
          ...automatic.category,
          value: undefined,
          label: undefined,
          status: 'not_available',
          confidence: 'unknown',
          origin: 'technician_selection',
          evidence: candidate?.evidence ?? automatic.category.evidence,
          discrepancies: [],
          warnings: [
            ...automatic.category.warnings,
            'La zona seleccionada no contiene una categoría estructurada.',
          ],
          nextAction: 'review_official_sources',
        },
  }
}

export function actionAreaParcelSurface(
  resolution: TerritorialResolution | undefined
) {
  const candidates = resolution?.planning.classificationResolution?.candidates ?? []
  return candidates.find((candidate) => candidate.parcelCoverage)?.parcelCoverage
    ?.parcelAreaSquareMetres
}
