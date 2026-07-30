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

const DOCUMENTARY_REVIEW_REASONS = new Set<ClassificationReviewReason>([
  'planning_update_scope_pending',
  'instrument_traceability_pending',
  'incomplete_source_check',
])

const CONFIDENCE_SCORE: Record<TerritorialConfidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
}

function semanticKey(candidate: ClassificationCandidate) {
  return `${candidate.classification.code}|${candidate.classification.categoryCode ?? ''}`
}

function sourceKey(candidate: ClassificationCandidate) {
  return candidate.sourceKey ?? candidate.source
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

function proposalFor(
  candidates: ClassificationCandidate[],
  reviewReasons: ReadonlySet<ClassificationReviewReason>
): ClassificationProposal | undefined {
  if (reviewReasons.has('partial_parcel_coverage')) return undefined
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

function rankedCandidates(candidates: ClassificationCandidate[]) {
  return [...candidates].sort(
    (left, right) => reliabilityScore(right) - reliabilityScore(left) || left.id.localeCompare(right.id)
  )
}

function automaticSelection(
  candidate: ClassificationCandidate,
  agreeingCandidates: ClassificationCandidate[]
): ClassificationSelection {
  const corroboratingSources = [
    ...new Set(
      agreeingCandidates
        .filter((item) => item.id !== candidate.id)
        .map(sourceKey)
    ),
  ]
  const reason = corroboratingSources.length
    ? `Selección priorizada por evidencia espacial y trazabilidad verificadas, corroborada por ${corroboratingSources.length} fuente(s) compatible(s).`
    : 'Selección priorizada por evidencia espacial, trazabilidad con el instrumento vigente y normalización inequívoca.'
  return {
    origin: 'automatic',
    candidateId: candidate.id,
    classificationCode: candidate.classification.code,
    categoryCode: candidate.classification.categoryCode,
    areaNames: candidate.areas.map((area) => area.name),
    reason,
    primarySource: sourceKey(candidate),
    corroboratingSources,
    confidence: candidate.confidence,
    technicianValidated: false,
  }
}

function probableSelection(
  candidate: ClassificationCandidate,
  agreeingCandidates: ClassificationCandidate[],
  reviewReasons: ReadonlySet<ClassificationReviewReason>
): ClassificationSelection {
  const selection = automaticSelection(candidate, agreeingCandidates)
  return {
    ...selection,
    reason: `Clasificación única respaldada por evidencia oficial. Requiere comprobar: ${[
      ...reviewReasons,
    ].join(', ')}.`,
    confidence: candidate.confidence === 'high' ? 'medium' : candidate.confidence,
  }
}

function hasOnlyDocumentaryUncertainty(
  reviewReasons: ReadonlySet<ClassificationReviewReason>
) {
  return (
    reviewReasons.size > 0 &&
    [...reviewReasons].every((reason) => DOCUMENTARY_REVIEW_REASONS.has(reason))
  )
}

export function assessClassificationResolution(resolution?: ClassificationResolution) {
  if (!resolution || resolution.candidates.length === 0) {
    return {
      level: 'unknown' as const,
      reason: 'Las fuentes consultadas no proporcionan una clasificación utilizable.',
      sources: [] as string[],
      warnings: [] as string[],
    }
  }

  const semanticClassifications = new Set(resolution.candidates.map(semanticKey))
  const reviewReasons = new Set(resolution.reviewReasons)
  const historicallyProbable =
    resolution.status === 'review_required' &&
    semanticClassifications.size === 1 &&
    hasOnlyDocumentaryUncertainty(reviewReasons)
  const level =
    resolution.status === 'clear'
      ? ('confirmed' as const)
      : resolution.status === 'probable' || historicallyProbable
        ? ('probable' as const)
        : ('unknown' as const)
  const selectedId =
    resolution.finalSelection?.candidateId ??
    resolution.automaticSelection?.candidateId ??
    (level === 'probable' ? resolution.proposal?.candidateId : undefined)
  const candidate =
    resolution.candidates.find((item) => item.id === selectedId) ??
    (level !== 'unknown' ? rankedCandidates(resolution.candidates)[0] : undefined)
  const sources = candidate
    ? [
        ...new Set([
          sourceKey(candidate),
          ...candidate.evidence.map((item) => item.sourceUrl),
        ]),
      ]
    : []
  const warnings = resolution.discrepancies.map((item) => item.explanation)

  return {
    level,
    candidate,
    reason:
      resolution.automaticSelection?.reason ??
      resolution.proposal?.explanation ??
      (level === 'unknown'
        ? 'La incertidumbre espacial o la incompatibilidad entre resultados impide adoptar una clasificación.'
        : 'Clasificación única obtenida de evidencia oficial.'),
    sources,
    warnings,
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
      confidenceLevel: 'unknown',
      nextAction: requiredSourceUnavailable ? 'retry_source' : 'manual_selection',
      candidates,
      discrepancies,
      reviewReasons: [...new Set(discrepancies.map((item) => item.reason))],
      sourceChecks,
      officialLinks,
      evidence,
    }
  }

  const semanticClassifications = new Set(candidates.map(semanticKey))
  const classificationsBySource = new Map<string, Set<string>>()
  for (const candidate of candidates) {
    const classifications = classificationsBySource.get(sourceKey(candidate)) ?? new Set<string>()
    classifications.add(semanticKey(candidate))
    classificationsBySource.set(sourceKey(candidate), classifications)
  }
  const sourceClassificationSets = [
    ...new Set(
      [...classificationsBySource.values()].map((values) => [...values].sort().join(','))
    ),
  ]
  if (
    semanticClassifications.size > 1 &&
    sourceClassificationSets.length > 1 &&
    !discrepancies.some((item) => item.reason === 'source_disagreement')
  ) {
    discrepancies.push({
      reason: 'source_disagreement',
      field: 'classification',
      explanation: 'Las fuentes oficiales compatibles devuelven clasificaciones distintas para la misma parcela.',
      assertions: candidates.map((candidate) => ({
        candidateId: candidate.id,
        value: semanticKey(candidate),
        source: candidate.source,
        evidence: candidate.evidence,
      })),
    })
  }

  const reviewReasons = derivedReviewReasons(candidates)
  for (const discrepancy of discrepancies) reviewReasons.add(discrepancy.reason)
  if (requiredSourceUnavailable) reviewReasons.add('incomplete_source_check')

  const blockingDiscrepancies = discrepancies.filter(
    (discrepancy) =>
      discrepancy.reason !== 'point_geometry_mismatch' &&
      discrepancy.reason !== 'partial_parcel_coverage'
  )
  const allAreVerifiedParcelIntersections = candidates.every(
    (candidate) =>
      candidate.evidenceBasis === 'parcel_geometry' &&
      candidate.instrumentTraceability === 'verified' &&
      candidate.normalizationStatus === 'mapped'
  )

  if (
    semanticClassifications.size > 1 &&
    sourceClassificationSets.length === 1 &&
    allAreVerifiedParcelIntersections &&
    blockingDiscrepancies.length === 0 &&
    !requiredSourceUnavailable
  ) {
    return {
      status: 'multiple_intersections',
      confidenceLevel: 'unknown',
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
    const selected = rankedCandidates(candidates)[0]
    return {
      status: 'clear',
      confidenceLevel: 'confirmed',
      nextAction: 'auto_accept',
      candidates,
      discrepancies,
      reviewReasons: [],
      automaticSelection: automaticSelection(selected, candidates),
      sourceChecks,
      officialLinks,
      evidence,
    }
  }

  if (
    semanticClassifications.size === 1 &&
    hasOnlyDocumentaryUncertainty(reviewReasons) &&
    candidates.every((candidate) => candidate.normalizationStatus === 'mapped')
  ) {
    const selected = rankedCandidates(candidates)[0]
    return {
      status: 'probable',
      confidenceLevel: 'probable',
      nextAction: 'review_official_sources',
      candidates,
      discrepancies,
      reviewReasons: [...reviewReasons],
      automaticSelection: probableSelection(selected, candidates, reviewReasons),
      sourceChecks,
      officialLinks,
      evidence,
    }
  }

  return {
    status: 'review_required',
    confidenceLevel: 'unknown',
    nextAction: 'review_official_sources',
    candidates,
    discrepancies,
    reviewReasons: [...reviewReasons],
    proposal: proposalFor(candidates, reviewReasons),
    sourceChecks,
    officialLinks,
    evidence,
  }
}
