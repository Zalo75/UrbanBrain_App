import type {
  ClassificationCandidate,
  ClassificationResolution,
  ConsolidationFactValue,
  PlanningApplicability,
  TerritorialConfidence,
  UrbanisticFact,
  UrbanisticFactNextAction,
  UrbanisticFactOrigin,
  UrbanisticFactStatus,
  UrbanisticRegimeFacts,
} from './types'

function currentInstrumentId(planning: PlanningApplicability) {
  return planning.applicableInstruments?.find((instrument) => instrument.status === 'current')?.id
}

function candidateForLegacyResolution(
  planning: PlanningApplicability,
  resolution?: ClassificationResolution
) {
  const selectedId =
    resolution?.finalSelection?.candidateId ?? resolution?.automaticSelection?.candidateId
  return (
    resolution?.candidates.find((candidate) => candidate.id === selectedId) ??
    resolution?.candidates[0] ??
    (planning.classification
      ? ({
          id: 'legacy-planning-classification',
          kind: 'official_classification',
          classification: planning.classification,
          evidence: planning.evidence,
          confidence: 'medium',
          evidenceBasis: 'official_document',
          instrumentTraceability: 'pending',
          normalizationStatus: 'mapped',
          areas: [],
          source: 'siotuga',
        } as ClassificationCandidate)
      : undefined)
  )
}

function factStatus(
  resolution: ClassificationResolution | undefined,
  hasEvidence: boolean
): UrbanisticFactStatus {
  if (resolution?.status === 'clear') return 'automatic_confirmed'
  if (resolution?.status === 'probable') return 'automatic_probable'
  if (resolution?.status === 'multiple_intersections') return 'conflict'
  if (resolution?.status === 'review_required') return 'manual_review_required'
  if (resolution?.status === 'source_unavailable') return 'source_unavailable'
  if (resolution?.status === 'not_available') return 'not_available'
  if (!hasEvidence) {
    return 'not_available'
  }
  return 'manual_review_required'
}

function factOrigin(candidate?: ClassificationCandidate): UrbanisticFactOrigin | undefined {
  if (!candidate) return undefined
  return candidate.evidenceBasis === 'parcel_geometry'
    ? 'spatial_intersection'
    : candidate.evidenceBasis === 'official_document'
      ? 'official_document'
      : 'automatic_source'
}

function nextAction(
  status: UrbanisticFactStatus
): UrbanisticFactNextAction {
  if (status === 'automatic_confirmed' || status === 'not_applicable') return 'none'
  if (status === 'source_unavailable') return 'retry_source'
  if (status === 'not_available') return 'manual_selection'
  return 'review_official_sources'
}

function warnings(resolution?: ClassificationResolution) {
  return resolution?.discrepancies.map((discrepancy) => discrepancy.explanation) ?? []
}

function evidence(planning: PlanningApplicability, resolution?: ClassificationResolution) {
  return resolution?.evidence.length ? resolution.evidence : planning.evidence
}

function confidence(candidate?: ClassificationCandidate): TerritorialConfidence | 'unknown' {
  return candidate?.confidence ?? 'unknown'
}

function fact<T>(input: {
  value?: T
  label?: string
  status: UrbanisticFactStatus
  candidate?: ClassificationCandidate
  planning: PlanningApplicability
  resolution?: ClassificationResolution
  resolvedAt?: string
  additionalWarnings?: string[]
}): UrbanisticFact<T> {
  return {
    value: input.value,
    label: input.label,
    status: input.status,
    origin: factOrigin(input.candidate),
    confidence: confidence(input.candidate),
    evidence: evidence(input.planning, input.resolution),
    warnings: [...warnings(input.resolution), ...(input.additionalWarnings ?? [])],
    discrepancies: input.resolution?.discrepancies ?? [],
    nextAction: nextAction(input.status),
    resolvedAt: input.resolvedAt,
    instrumentId: currentInstrumentId(input.planning),
  }
}

/**
 * Adapta la resolución histórica, sin modificarla, a hechos independientes.
 * Los consumidores legacy siguen usando `classificationResolution`.
 */
export function urbanisticFactsFromClassificationResolution(
  planning: PlanningApplicability,
  resolvedAt?: string
): UrbanisticRegimeFacts {
  const resolution = planning.classificationResolution
  const candidate = candidateForLegacyResolution(planning, resolution)
  const isOfficial = candidate?.kind === 'official_classification'
  const classificationStatus = factStatus(resolution, Boolean(isOfficial && candidate?.classification.code))
  const classificationAvailable =
    classificationStatus === 'automatic_confirmed' ||
    classificationStatus === 'automatic_probable'
  const classification = fact({
    value: classificationAvailable && isOfficial && candidate
      ? { code: candidate.classification.code, label: candidate.classification.label }
      : undefined,
    label: classificationAvailable && isOfficial && candidate ? candidate.classification.label : undefined,
    status: classificationStatus,
    candidate,
    planning,
    resolution,
    resolvedAt,
  })

  const categoryAvailable = Boolean(
    isOfficial &&
    candidate?.classification.categoryCode &&
      (classificationStatus === 'automatic_confirmed' ||
        classificationStatus === 'automatic_probable')
  )
  const categoryStatus: UrbanisticFactStatus = categoryAvailable
    ? classificationStatus
    : classificationStatus === 'conflict'
      ? 'conflict'
      : classificationStatus === 'source_unavailable'
        ? 'source_unavailable'
        : classificationStatus === 'not_available'
          ? 'not_available'
          : isOfficial && candidate?.classification.code
      ? 'manual_review_required'
      : 'not_available'
  const category = fact({
    value: categoryAvailable && isOfficial && candidate
      ? {
          code: candidate.classification.categoryCode!,
          label: candidate.classification.categoryLabel,
        }
      : undefined,
    label: categoryAvailable && isOfficial && candidate ? candidate.classification.categoryLabel : undefined,
    status: categoryStatus,
    candidate,
    planning,
    resolution,
    resolvedAt,
    additionalWarnings:
      categoryStatus === 'manual_review_required'
        ? [
            'No ha sido posible determinar automáticamente la categoría del suelo. Puede requerir consulta del Ayuntamiento o revisión del planeamiento.',
          ]
        : undefined,
  })

  const consolidationStatus: UrbanisticFactStatus =
    classificationStatus === 'conflict'
      ? 'conflict'
      : classificationStatus === 'source_unavailable'
        ? 'source_unavailable'
        : classificationStatus === 'not_available'
          ? 'not_available'
          : isOfficial && candidate?.classification.code === 'SU'
      ? 'manual_review_required'
      : isOfficial && candidate?.classification.code
        ? 'not_applicable'
        : 'not_available'
  const consolidation = fact<ConsolidationFactValue>({
    status: consolidationStatus,
    candidate,
    planning,
    resolution,
    resolvedAt,
    additionalWarnings:
      consolidationStatus === 'manual_review_required'
        ? [
            'No ha sido posible determinar automáticamente si el suelo urbano es consolidado o no consolidado. Consulte el planeamiento municipal y, cuando proceda, confirme los servicios urbanísticos.',
          ]
        : undefined,
  })

  return { classification, category, consolidation }
}

export function withUrbanisticFacts(
  planning: PlanningApplicability,
  resolvedAt?: string
): PlanningApplicability {
  return {
    ...planning,
    urbanisticFacts: urbanisticFactsFromClassificationResolution(planning, resolvedAt),
  }
}
