import type {
  ClassificationCandidate,
  ClassificationDiscrepancy,
  ClassificationProposal,
  ClassificationResolution,
  ClassificationReviewReason,
  ClassificationSelection,
  ClassificationSourceCheck,
  OfficialResourceLink,
  TerritorialConfidence,
  TerritorialEvidence,
} from './types'

export interface EvaluateClassificationInput {
  candidates: ClassificationCandidate[]
  discrepancies?: ClassificationDiscrepancy[]
  sourceChecks: ClassificationSourceCheck[]
  officialLinks?: OfficialResourceLink[]
  evidence?: TerritorialEvidence[]
}

const FAILED_SOURCE_STATUSES = new Set(['timeout', 'unavailable', 'malformed', 'partial'])

const CONFIDENCE_SCORE: Record<TerritorialConfidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
}

function semanticKey(candidate: ClassificationCandidate) {
  return `${candidate.classification.code}|${candidate.classification.categoryCode ?? ''}`
}

function derivedReviewReasons(candidates: ClassificationCandidate[]) {
  const reasons = new Set<ClassificationReviewReason>()
  for (const candidate of candidates) {
    if (candidate.instrumentTraceability === 'pending') {
      reasons.add('instrument_traceability_pending')
    }
    if (candidate.instrumentTraceability === 'mismatch') {
      reasons.add('instrument_layer_mismatch')
    }
    if (candidate.normalizationStatus === 'unmapped') {
      reasons.add('ambiguous_code_mapping')
    }
    if (candidate.evidenceBasis === 'official_document') {
      reasons.add('insufficient_geometry')
    }
  }
  return reasons
}

function allEvidence(input: EvaluateClassificationInput) {
  const byIdentity = new Map<string, TerritorialEvidence>()
  for (const item of [
    ...(input.evidence ?? []),
    ...input.candidates.flatMap((candidate) => candidate.evidence),
  ]) {
    const identity = `${item.source}|${item.sourceUrl}|${item.retrievedAt}|${item.method}|${item.scope ?? ''}`
    byIdentity.set(identity, item)
  }
  return [...byIdentity.values()]
}

function reliabilityScore(candidate: ClassificationCandidate) {
  const basis = {
    parcel_geometry: 300,
    representative_point: 200,
    official_document: 100,
  }[candidate.evidenceBasis]
  const traceability = {
    verified: 30,
    pending: 10,
    mismatch: 0,
  }[candidate.instrumentTraceability]
  const normalization = candidate.normalizationStatus === 'mapped' ? 3 : 0
  return basis + traceability + normalization + CONFIDENCE_SCORE[candidate.confidence]
}

function proposalFor(candidates: ClassificationCandidate[]): ClassificationProposal | undefined {
  const candidate = [...candidates].sort(
    (left, right) => reliabilityScore(right) - reliabilityScore(left) || left.id.localeCompare(right.id)
  )[0]
  if (!candidate) return undefined

  const basis = {
    parcel_geometry: 'intersección con la geometría completa de la parcela',
    representative_point: 'consulta sobre el punto representativo oficial',
    official_document: 'evidencia del documento oficial sin resolución parcelaria completa',
  }[candidate.evidenceBasis]
  const traceability = {
    verified: 'verificada',
    pending: 'pendiente de verificar',
    mismatch: 'no coincidente con el instrumento identificado',
  }[candidate.instrumentTraceability]

  return {
    candidateId: candidate.id,
    explanation: `Propuesta priorizada por ${basis} y trazabilidad ${traceability}.`,
    confidence: candidate.confidence,
    requiresProfessionalReview: true,
  }
}

function automaticSelection(candidate: ClassificationCandidate): ClassificationSelection {
  return {
    origin: 'automatic',
    candidateId: candidate.id,
    classificationCode: candidate.classification.code,
    categoryCode: candidate.classification.categoryCode,
    areaNames: candidate.areas.map((area) => area.name),
    technicianValidated: false,
  }
}

export function evaluateClassificationResolution(
  input: EvaluateClassificationInput
): ClassificationResolution {
  const candidates = [...input.candidates]
  const discrepancies = [...(input.discrepancies ?? [])]
  const sourceChecks = [...input.sourceChecks]
  const officialLinks = [...(input.officialLinks ?? [])]
  const evidence = allEvidence(input)
  const requiredSourceUnavailable = sourceChecks.some(
    (check) =>
      check.requiredForAutomaticDecision && FAILED_SOURCE_STATUSES.has(check.status)
  )

  if (candidates.length === 0) {
    return {
      status: requiredSourceUnavailable ? 'source_unavailable' : 'not_available',
      nextAction: requiredSourceUnavailable ? 'retry_source' : 'manual_selection',
      candidates,
      discrepancies,
      reviewReasons: [...new Set(discrepancies.map((item) => item.reason))],
      sourceChecks,
      officialLinks,
      evidence,
    }
  }

  const reviewReasons = derivedReviewReasons(candidates)
  for (const discrepancy of discrepancies) reviewReasons.add(discrepancy.reason)
  if (requiredSourceUnavailable) reviewReasons.add('incomplete_source_check')

  const semanticClassifications = new Set(candidates.map(semanticKey))
  const blockingDiscrepancies = discrepancies.filter(
    (discrepancy) => discrepancy.reason !== 'point_geometry_mismatch'
  )
  const allAreVerifiedParcelIntersections = candidates.every(
    (candidate) =>
      candidate.evidenceBasis === 'parcel_geometry' &&
      candidate.instrumentTraceability === 'verified' &&
      candidate.normalizationStatus === 'mapped'
  )

  if (
    semanticClassifications.size > 1 &&
    allAreVerifiedParcelIntersections &&
    blockingDiscrepancies.length === 0 &&
    !requiredSourceUnavailable
  ) {
    return {
      status: 'multiple_intersections',
      nextAction: 'manual_selection',
      candidates,
      discrepancies,
      reviewReasons: [...new Set(discrepancies.map((item) => item.reason))],
      sourceChecks,
      officialLinks,
      evidence,
    }
  }

  if (
    semanticClassifications.size === 1 &&
    reviewReasons.size === 0 &&
    !requiredSourceUnavailable
  ) {
    return {
      status: 'clear',
      nextAction: 'auto_accept',
      candidates,
      discrepancies,
      reviewReasons: [],
      automaticSelection: automaticSelection(candidates[0]),
      sourceChecks,
      officialLinks,
      evidence,
    }
  }

  return {
    status: 'review_required',
    nextAction: 'review_official_sources',
    candidates,
    discrepancies,
    reviewReasons: [...reviewReasons],
    proposal: proposalFor(candidates),
    sourceChecks,
    officialLinks,
    evidence,
  }
}
