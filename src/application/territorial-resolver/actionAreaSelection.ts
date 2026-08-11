import type {
  ActionAreaSelection,
  ActionAreaSelectionSnapshot,
  ActionAreaSelectionState,
  AffectApplicability,
  ClassificationCandidate,
  ClassificationResolution,
  DeterminationVerification,
  ManualTerritorialContext,
  OfficialClassificationCandidate,
  ParcelGeometry,
  PlanningClassification,
  TerritorialResolution,
  UrbanisticRegimeFacts,
} from '@/domain/territorial-resolver/types'

function normalizedCode(value: string | undefined) {
  return value?.trim().toUpperCase() || undefined
}

function normalizedName(value: string) {
  return value.normalize('NFC').trim().toLocaleLowerCase('es')
}

function sameNames(left: string[], right: string[]) {
  const normalized = (values: string[]) => [
    ...new Set(values.map(normalizedName).filter(Boolean)),
  ].sort()
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right))
}

function sameGeometry(left: ParcelGeometry, right: ParcelGeometry) {
  return left.crs === right.crs && JSON.stringify(left.coordinates) === JSON.stringify(right.coordinates)
}

function automaticFactsMatchCandidate(
  facts: UrbanisticRegimeFacts,
  candidate: OfficialClassificationCandidate
) {
  return (
    facts.classification.status === 'automatic_confirmed' &&
    facts.category.status === 'automatic_confirmed' &&
    normalizedCode(facts.classification.value?.code) ===
      normalizedCode(candidate.classification.code) &&
    normalizedCode(facts.category.value?.code) ===
      normalizedCode(candidate.classification.categoryCode)
  )
}

export function planningZoneNamesFromCandidate(candidate?: ClassificationCandidate): string[] {
  if (!candidate) return []
  const areaNames = [
    ...new Set(candidate.areas.map((area) => area.name.trim()).filter(Boolean)),
  ]
  if (areaNames.length > 0) return areaNames
  if (candidate.kind !== 'official_classification') return []
  const categoryLabel = candidate.classification.categoryLabel?.trim()
  return categoryLabel ? [categoryLabel] : []
}

export function clearAutomaticClassificationCandidate(
  resolution?: ClassificationResolution,
  planningClassification?: PlanningClassification,
  automaticFacts?: UrbanisticRegimeFacts
): OfficialClassificationCandidate | undefined {
  if (
    !resolution ||
    resolution.status !== 'clear' ||
    resolution.nextAction !== 'auto_accept' ||
    (resolution.confidenceLevel !== undefined && resolution.confidenceLevel !== 'confirmed') ||
    resolution.candidates.length !== 1 ||
    (resolution.discrepancies?.length ?? 0) > 0 ||
    (resolution.reviewReasons?.length ?? 0) > 0 ||
    resolution.proposal !== undefined ||
    (resolution.sourceChecks ?? []).some((check) => check.status !== 'available')
  ) return undefined

  const candidate = resolution.candidates[0]
  const automaticSelection = resolution.automaticSelection
  const candidateAreaNames = candidate.areas.map((area) => area.name)
  const effectiveAreaNames = planningZoneNamesFromCandidate(candidate)
  if (
    candidate.kind !== 'official_classification' ||
    candidate.normalizationStatus !== 'mapped' ||
    candidate.instrumentTraceability !== 'verified' ||
    candidate.evidenceBasis !== 'parcel_geometry' ||
    candidate.confidence !== 'high' ||
    !candidate.parcelCoverage?.intersectionGeometry ||
    candidate.parcelCoverage.intersectionAreaSquareMetres <= 0 ||
    candidate.parcelCoverage.parcelAreaSquareMetres <= 0 ||
    effectiveAreaNames.length !== 1 ||
    !automaticSelection ||
    automaticSelection.origin !== 'automatic' ||
    automaticSelection.technicianValidated ||
    automaticSelection.candidateId !== candidate.id ||
    normalizedCode(automaticSelection.classificationCode) !==
      normalizedCode(candidate.classification.code) ||
    normalizedCode(automaticSelection.categoryCode) !==
      normalizedCode(candidate.classification.categoryCode) ||
    !(
      sameNames(automaticSelection.areaNames, candidateAreaNames) ||
      (candidateAreaNames.length === 0 &&
        sameNames(automaticSelection.areaNames, effectiveAreaNames))
    )
  ) return undefined

  if (
    planningClassification &&
    (normalizedCode(planningClassification.code) !== normalizedCode(candidate.classification.code) ||
      normalizedCode(planningClassification.categoryCode) !==
        normalizedCode(candidate.classification.categoryCode))
  ) return undefined

  if (automaticFacts && !automaticFactsMatchCandidate(automaticFacts, candidate)) {
    return undefined
  }

  const finalSelection = resolution.finalSelection
  if (
    finalSelection &&
    (finalSelection.origin !== 'automatic' ||
      finalSelection.technicianValidated ||
      finalSelection.candidateId !== candidate.id ||
      normalizedCode(finalSelection.classificationCode) !==
        normalizedCode(candidate.classification.code) ||
      normalizedCode(finalSelection.categoryCode) !==
        normalizedCode(candidate.classification.categoryCode) ||
      !sameNames(finalSelection.areaNames, automaticSelection.areaNames))
  ) return undefined

  return candidate
}

export function matchesClearAutomaticDetectedZone(
  resolution: TerritorialResolution | undefined,
  selection?: ActionAreaSelection,
  automaticFacts?: UrbanisticRegimeFacts
) {
  if (
    !selection ||
    selection.selectionType !== 'detected_zone' ||
    selection.verification !== 'unverified'
  ) return false

  const candidate = clearAutomaticClassificationCandidate(
    resolution?.planning.classificationResolution,
    resolution?.planning.classification,
    resolution?.planning.urbanisticFacts
  )
  const coverage = candidate?.parcelCoverage
  if (
    !candidate ||
    !coverage?.intersectionGeometry ||
    resolution?.planning.status !== 'determined' ||
    (resolution.planning.conflicts?.length ?? 0) > 0 ||
    selection.selectedCandidateId !== candidate.id
  ) return false
  if (
    normalizedCode(selection.classification) !== normalizedCode(candidate.classification.code) ||
    normalizedCode(selection.category) !== normalizedCode(candidate.classification.categoryCode) ||
    selection.source !== candidate.source ||
    selection.confidence !== candidate.confidence ||
    selection.affects !== undefined ||
    selection.surfaceSquareMetres !== coverage.intersectionAreaSquareMetres ||
    selection.parcelSurfaceSquareMetres !== coverage.parcelAreaSquareMetres ||
    !sameGeometry(selection.geometry, coverage.intersectionGeometry)
  ) return false

  const candidateZones = planningZoneNamesFromCandidate(candidate)
  const selectedZones = selection.planningZones?.length
    ? selection.planningZones
    : selection.planningZone
      ? [selection.planningZone]
      : []
  if (!sameNames(selectedZones, candidateZones)) return false
  if (
    selection.planningZone &&
    normalizedName(selection.planningZone) !== normalizedName(candidateZones.join(', '))
  ) return false

  if (
    automaticFacts &&
    !automaticFactsMatchCandidate(automaticFacts, candidate)
  ) return false

  return true
}

export function hasManualInterventionBeyondActionArea(
  manual?: ManualTerritorialContext | null
) {
  if (!manual) return false
  return Boolean(
    manual.cadastralReference?.trim() ||
    manual.municipality?.trim() ||
    manual.address?.trim() ||
    manual.coordinates ||
    manual.classification?.trim() ||
    manual.category?.trim() ||
    manual.area?.trim() ||
    manual.ordinance?.trim() ||
    manual.observations?.trim() ||
    manual.affectDecisions?.length ||
    manual.urbanisticFacts?.classification ||
    manual.urbanisticFacts?.category ||
    manual.urbanisticFacts?.consolidation ||
    manual.classificationDetermination?.technician ||
    manual.categoryDetermination?.technician ||
    manual.ordinanceDetermination?.technician ||
    manual.validatedAt ||
    manual.validatedBy
  )
}

export function isPureAutomaticDetectedZoneContext(
  resolution: TerritorialResolution | undefined,
  manual?: ManualTerritorialContext | null
) {
  const state = manual?.actionAreaSelection
  const selection = state?.current
  return Boolean(
    manual &&
    manual.verification === 'unverified' &&
    state &&
    selection &&
    (state.history?.length ?? 0) === 0 &&
    !state.revokedAt &&
    !state.revokedBy &&
    !selection.previousSnapshot &&
    !hasManualInterventionBeyondActionArea(manual) &&
    matchesClearAutomaticDetectedZone(
      resolution,
      selection,
      resolution?.planning.urbanisticFacts
    )
  )
}

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
  const planningZones = planningZoneNamesFromCandidate(input.candidate)
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
  if (matchesClearAutomaticDetectedZone(resolution, selection, automatic)) {
    return automatic
  }
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
      origin: selection.verification === 'technician_validated'
        ? 'technician_confirmation'
        : 'spatial_intersection',
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
          origin: selection.verification === 'technician_validated'
            ? 'technician_confirmation'
            : 'spatial_intersection',
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
          origin: selection.verification === 'technician_validated'
            ? 'technician_confirmation'
            : 'spatial_intersection',
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
