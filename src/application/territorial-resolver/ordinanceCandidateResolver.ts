import type {
  OrdinanceCandidate,
  OrdinanceResolutionMetadata,
  OrdinanceReviewMaterial,
  PlanningApplicability,
  TerritorialConfidence,
  TerritorialCoordinates,
  UrbanisticIdentitySemanticType,
  VisualZoningInterpretation,
  VisualZoningObservation,
} from '@/domain/territorial-resolver/types'
import { isExternalServiceFailure } from '@/infrastructure/territorial-resolver/officialHttp'

/** Evidence observed by one detailed-zoning strategy. */
export interface DetailedZoningObservation {
  identity: string
  semanticDimension?: UrbanisticIdentitySemanticType
  instrumentId: string
  sourceRef?: string
  sourceDocument?: string
  spatialEvidence?: string
  graphicEvidence?: string
  legendEvidence?: string
  documentaryEvidence?: string
  instrumentMembership?: boolean
  provenance?: string[]
  coverage?: OrdinanceCandidate['coverage']
  confidence?: TerritorialConfidence
  alignmentMethod?: string
  estimatedErrorMeters?: number
  warning?: string
  reason?: string
  reviewMaterials?: OrdinanceReviewMaterial
}

export interface DetailedZoningStrategyContext {
  planning: PlanningApplicability
  municipalityCode?: string
  coordinates?: TerritorialCoordinates
  geometry?: unknown
}

export interface DetailedZoningStrategy {
  id: string
  resolve(context: DetailedZoningStrategyContext): Promise<DetailedZoningObservation[]>
  /** Optional raw visual result retained independently from canonical candidates. */
  getVisualResult?(): VisualZoningInterpretation | undefined
  getSourceFailure?(): string | undefined
  getHasEligibilitySignal?(): any
}

export type OrdinanceResolutionStatus =
  | 'automatically_determined'
  | 'assisted_confirmation_required'
  | 'manual_confirmation_required'
  | 'ambiguous'
  | 'multizone'

export interface OrdinanceResolution {
  candidates: OrdinanceCandidate[]
  contextualCandidates?: OrdinanceCandidate[]
  status: OrdinanceResolutionStatus
  metadata: OrdinanceResolutionMetadata
}

function normalizeIdentity(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function isComplete(observation: DetailedZoningObservation, instrumentId: string) {
  return Boolean(
    observation.identity.trim() &&
      observation.instrumentId === instrumentId &&
      observation.instrumentMembership !== false &&
      observation.spatialEvidence &&
      observation.graphicEvidence &&
      observation.legendEvidence &&
      observation.documentaryEvidence &&
      observation.sourceRef
  )
}

function planningContextIdentityKeys(planning?: PlanningApplicability) {
  const values = [
    planning?.classification?.code,
    planning?.classification?.categoryCode,
    planning?.classification?.label,
    planning?.classification?.categoryLabel,
    planning?.urbanisticFacts?.classification.value?.code,
    planning?.urbanisticFacts?.classification.value?.label,
    planning?.urbanisticFacts?.category.value?.code,
    planning?.urbanisticFacts?.category.value?.label,
  ]
  return new Set(values.filter((value): value is string => Boolean(value?.trim())).map(normalizeIdentity))
}

/**
 * The VLM's dimension is an observation, not an authority.  In particular,
 * historical maps often contain a category and an ordinance in the same
 * image, and the model can label both as `category`.  Keep an identity in the
 * contextual bucket only when the official planning context corroborates it;
 * otherwise preserve it as a detailed candidate (or unknown) so that a noisy
 * label can never erase valid evidence.
 */
function resolveSemanticDimension(
  observation: DetailedZoningObservation,
  planning?: PlanningApplicability,
): UrbanisticIdentitySemanticType | undefined {
  const reported = observation.semanticDimension
  if (reported === 'ordinance' || reported === 'zoning' || reported === 'qualification' || reported === 'degree') {
    return reported
  }

  const contextKeys = planningContextIdentityKeys(planning)
  if (contextKeys.has(normalizeIdentity(observation.identity))) {
    return reported === 'classification' || reported === 'category' || reported === 'area' || reported === 'affect' || reported === 'protection'
      ? reported
      : 'category'
  }

  if (reported === 'classification' || reported === 'category' || reported === undefined) {
    // Preserve the model's semantic observation.  Documentary evidence can
    // validate a label, but cannot promote a classification/category into an
    // ordinance; the visual observation remains available for review.
    return reported
  }
  return reported
}

function toCandidate(observation: DetailedZoningObservation, planning?: PlanningApplicability): OrdinanceCandidate {
  return {
    identity: observation.identity.trim(),
    normalizedIdentity: normalizeIdentity(observation.identity),
    semanticDimension: resolveSemanticDimension(observation, planning),
    instrumentId: observation.instrumentId,
    sourceRef: observation.sourceRef,
    sourceDocument: observation.sourceDocument,
    spatialEvidence: observation.spatialEvidence,
    graphicEvidence: observation.graphicEvidence,
    legendEvidence: observation.legendEvidence,
    documentaryEvidence: observation.documentaryEvidence,
    instrumentMembership: observation.instrumentMembership !== false,
    provenance: [...new Set(observation.provenance ?? [observation.sourceRef!])],
    coverage: observation.coverage,
    confidence: observation.confidence ?? 'medium',
    status: 'active',
    alignmentMethod: observation.alignmentMethod,
    estimatedErrorMeters: observation.estimatedErrorMeters,
    warning: observation.warning,
    reason: observation.reason,
    reviewMaterials: observation.reviewMaterials,
  }
}

function mergeVisualInterpretations(
  current: VisualZoningInterpretation | undefined,
  next: VisualZoningInterpretation | undefined,
): VisualZoningInterpretation | undefined {
  if (!next) return current
  const observations = [...(current?.observations ?? []), ...next.observations]
  const seen = new Set<string>()
  const unique = observations.filter((observation) => {
    const key = [
      observation.observedLabel,
      observation.observedCode,
      observation.observedNumber,
      observation.description,
      observation.spatialRelation ?? observation.parcelRelation,
    ].map((value) => value ?? '').join('|').trim()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const state = [current?.resolutionState, next.resolutionState].includes('multizone')
    ? 'multizone'
    : [current?.resolutionState, next.resolutionState].includes('ambiguous')
      ? 'ambiguous'
      : [current?.resolutionState, next.resolutionState].includes('resolved')
        ? 'resolved'
        : 'unresolved'
  return {
    resolutionState: state,
    observations: unique,
    explanation: [current?.explanation, next.explanation].filter(Boolean).join(' ' ) || undefined,
  }
}

function deduplicateCandidates(candidates: OrdinanceCandidate[]) {
  const map = new Map<string, OrdinanceCandidate>()
  for (const candidate of candidates) {
    const normalizedIdentity = candidate.normalizedIdentity ?? normalizeIdentity(candidate.identity)
    const key = `${candidate.semanticDimension ?? 'unknown'}|${normalizedIdentity}`
    const existing = map.get(key)
    if (!existing) {
      map.set(key, { ...candidate, normalizedIdentity: normalizedIdentity })
      continue
    }
    map.set(key, {
      ...existing,
      provenance: [...new Set([...existing.provenance, ...candidate.provenance])],
      sourceRef: existing.sourceRef ?? candidate.sourceRef,
      sourceDocument: existing.sourceDocument ?? candidate.sourceDocument,
      spatialEvidence: existing.spatialEvidence ?? candidate.spatialEvidence,
      graphicEvidence: existing.graphicEvidence ?? candidate.graphicEvidence,
      legendEvidence: existing.legendEvidence ?? candidate.legendEvidence,
      documentaryEvidence: existing.documentaryEvidence ?? candidate.documentaryEvidence,
      coverage: existing.coverage ?? candidate.coverage,
      confidence: existing.confidence === 'high' ? existing.confidence : candidate.confidence,
    })
  }
  return [...map.values()]
}

const contextualDimensions = new Set<UrbanisticIdentitySemanticType>([
  'classification',
  'category',
  'affect',
  'protection',
  'area',
])

function isContextualCandidate(candidate: OrdinanceCandidate, planning?: PlanningApplicability) {
  if (candidate.semanticDimension === undefined || !contextualDimensions.has(candidate.semanticDimension)) return false
  return planningContextIdentityKeys(planning).has(normalizeIdentity(candidate.identity))
}

function competingGroups(candidates: OrdinanceCandidate[]) {
  const groups = new Map<string, OrdinanceCandidate[]>()
  for (const candidate of candidates) {
    const key = candidate.semanticDimension ?? 'unknown'
    groups.set(key, [...(groups.get(key) ?? []), candidate])
  }
  return [...groups.values()].filter((group) => group.length > 1)
}

/**
 * Runs injected structured/PORD/original-sheet strategies and applies the
 * common evidence-convergence and instrument-scope rules.
 */
export async function resolveOrdinanceCandidatesDetailed(
  planning: PlanningApplicability,
  options: {
    strategies?: DetailedZoningStrategy[]
    observations?: DetailedZoningObservation[]
    municipalityCode?: string
    coordinates?: TerritorialCoordinates
    geometry?: unknown
  } = {}
): Promise<OrdinanceResolution> {
  const instrumentId = planning.applicableInstruments?.find(
    (instrument) => instrument.status === 'current'
  )?.id
  if (!instrumentId) return { candidates: [], status: 'manual_confirmation_required', metadata: reviewMetadata(planning, []) }

  // 1. Check pre-provided structured observations first
  const structuredValid = (options.observations ?? []).filter((obs) => isComplete(obs, instrumentId))
  if (structuredValid.length > 0) {
    const structuredResolution = buildResolution(structuredValid, planning)
    if (structuredResolution.candidates.length) return structuredResolution
  }

  let hasEligibilitySignal: any = undefined

  // 2. Evaluate strategies sequentially in order of priority (short-circuiting)
  const strategies = options.strategies ?? []
  const contextualObservations: DetailedZoningObservation[] = [...structuredValid]
  let visualInterpretation: VisualZoningInterpretation | undefined
  for (const strategy of strategies) {
    try {
      const strategyObservations = await strategy.resolve({
        planning,
        municipalityCode: options.municipalityCode,
        coordinates: options.coordinates,
        geometry: options.geometry,
      })
      if (strategy.getHasEligibilitySignal?.()) {
        hasEligibilitySignal = strategy.getHasEligibilitySignal()
      }
      const sourceFailure = strategy.getSourceFailure?.()
      planning.cartographicSourceChecks = [...(planning.cartographicSourceChecks ?? []), { provider: strategy.id, status: sourceFailure ? 'unavailable' : strategyObservations.length ? 'available' : 'no_observation', checkedAt: new Date().toISOString(), reason: sourceFailure }]
      visualInterpretation = mergeVisualInterpretations(visualInterpretation, strategy.getVisualResult?.())
      if (visualInterpretation) {
        planning.visualResolutionState = visualInterpretation.resolutionState
        planning.visualObservations = visualInterpretation.observations
        planning.visualExplanation = visualInterpretation.explanation
      }

      console.log('UB-E2E-TRACE strategy-observations', JSON.stringify({
        strategy: strategy.id,
        observations: strategyObservations.map((observation) => ({
          identity: observation.identity,
          semanticDimension: observation.semanticDimension ?? null,
          instrumentId: observation.instrumentId,
          sourceRef: observation.sourceRef,
          sourceDocument: observation.sourceDocument,
          instrumentMembership: observation.instrumentMembership,
          spatialEvidence: observation.spatialEvidence,
          graphicEvidence: observation.graphicEvidence,
          legendEvidence: observation.legendEvidence,
          documentaryEvidence: observation.documentaryEvidence,
          provenance: observation.provenance,
        })),
      }))
      
      const valid = strategyObservations.filter((obs) => isComplete(obs, instrumentId))
      if (valid.length > 0) {
        const resolution = buildResolution([...contextualObservations, ...valid], planning, hasEligibilitySignal)
        if (resolution.candidates.length > 0) return resolution
        contextualObservations.push(...valid)
      }
    } catch (error) {
      if (isExternalServiceFailure(error)) {
        planning.cartographicSourceChecks = [...(planning.cartographicSourceChecks ?? []), { provider: strategy.id, status: 'unavailable', checkedAt: new Date().toISOString(), reason: error instanceof Error ? error.name : 'External source failure' }]
        continue
      }
      throw error
    }
  }

  if (contextualObservations.length > 0) return buildResolution(contextualObservations, planning, hasEligibilitySignal)

  const metadata = reviewMetadata(planning, [])
  if (hasEligibilitySignal) metadata.hasEligibility = hasEligibilitySignal
  return { candidates: [], status: 'manual_confirmation_required', metadata }
}

function buildResolution(observations: DetailedZoningObservation[], planning?: PlanningApplicability, hasEligibilitySignal?: any): OrdinanceResolution {
  const allCandidates = deduplicateCandidates(observations.map((observation) => toCandidate(observation, planning)))
  const contextualCandidates = allCandidates.filter((candidate) => isContextualCandidate(candidate, planning))
  const candidates = allCandidates.filter((candidate) => !isContextualCandidate(candidate, planning))
  if (candidates.length === 0) {
    const metadata = reviewMetadata(undefined, [])
    metadata.contextualCandidates = contextualCandidates
    if (hasEligibilitySignal) metadata.hasEligibility = hasEligibilitySignal
    return { candidates: [], contextualCandidates, status: 'manual_confirmation_required', metadata }
  }
  if (candidates.length > 1) {
    const groups = competingGroups(candidates)
    if (groups.length === 0) {
      const allStructured = candidates.every(hasStructuredEvidence)
      return {
        candidates,
        contextualCandidates,
        status: 'automatically_determined',
        metadata: metadataForCandidates(candidates, allStructured ? 'RESOLVED' : 'REVIEW_REQUIRED', undefined, contextualCandidates, planning, hasEligibilitySignal),
      }
    }
    const status = groups.some((group) => group.some((candidate) => candidate.coverage?.percentage !== undefined))
      ? 'multizone' as const
      : 'ambiguous' as const
    return {
      candidates: candidates.map((candidate) => ({
        ...candidate,
        competingCandidates: (groups.find((group) => group.includes(candidate)) ?? [candidate])
          .map((item) => item.normalizedIdentity ?? item.identity),
      })),
      status,
      contextualCandidates,
      metadata: metadataForCandidates(candidates, 'REVIEW_REQUIRED', undefined, contextualCandidates, planning, hasEligibilitySignal),
    }
  }
  const candidate = candidates[0]!
  const precisionWarning = candidate.warning ||
    (candidate.estimatedErrorMeters !== undefined ? `Alineación automática; error estimado ${candidate.estimatedErrorMeters} m.` : undefined)
  const isReview = candidate.confidence === 'low'
  const isPrecision = !isReview && Boolean(precisionWarning)
  const isStructured = hasStructuredEvidence(candidate)
  const productStatus = isReview || (!isStructured && !isPrecision)
    ? 'REVIEW_REQUIRED'
    : isPrecision
      ? 'RESOLVED_WITH_PRECISION_WARNING'
      : 'RESOLVED'
  return {
    candidates,
    status: 'automatically_determined',
    contextualCandidates,
    metadata: metadataForCandidates(candidates, productStatus, precisionWarning, contextualCandidates, planning, hasEligibilitySignal),
  }
}

/**
 * Structured/vector sources carry an identity that does not depend on a
 * technician interpreting an imprecise legacy raster.  Keep this decision
 * source-based and generic: no municipality or instrument names belong here.
 */
function hasStructuredEvidence(candidate: OrdinanceCandidate): boolean {
  const evidence = [
    candidate.sourceRef,
    candidate.sourceDocument,
    ...candidate.provenance,
    candidate.spatialEvidence,
    candidate.graphicEvidence,
  ].filter(Boolean).join(' ')
  return /arcgis|featureserver|mapserver|\bwfs\b|vector|prepared[_ -]?zoning|structured/i.test(evidence)
}

function metadataForCandidates(
  candidates: OrdinanceCandidate[],
  status: OrdinanceResolutionMetadata['status'],
  warning?: string,
  contextualCandidates: OrdinanceCandidate[] = [],
  planning?: PlanningApplicability,
  hasEligibilitySignal?: any
): OrdinanceResolutionMetadata {
  const candidate = candidates[0]
  const material = candidates.find((item) => item.reviewMaterials)?.reviewMaterials
  const pordDocument = planning?.documents?.find((document) =>
    document.documentType === 'sheet' &&
    /\d+(?:pb|nr|su|ot)\d+\.(?:png|jpe?g|tiff?)(?:$|[?#])/i.test(document.sourceUrl),
  ) ?? planning?.documents?.find((document) =>
    /(?:p\.\s*ord|plano|ordenaci[oó]n|n[uú]cleo|suelo urbano)/i.test(document.title) &&
    !/cat[aá]logo|ficha|patrimonio|memoria|normativa/i.test(document.title) &&
    /\d+(?:pb|nr|su|ot)\d+\.(?:png|jpe?g|tiff?)(?:$|[?#])/i.test(document.sourceUrl),
  )
  const specificMapUrl = pordDocument?.sourceUrl ?? specificVisualUrl(material?.mapUrl)
  const specificLegendUrl = specificVisualUrl(material?.legendUrl)
  
  const metadata: OrdinanceResolutionMetadata = {
    status,
    identity: candidates.length === 1 && candidate ? { code: candidate.identity, label: candidate.identity } : undefined,
    confidence: candidates.length === 1 ? (candidate?.confidence ?? 'unknown') : 'unknown',
    source: candidate?.sourceRef,
    provenance: [...new Set(candidates.flatMap((item) => item.provenance))],
    alignmentMethod: candidate?.alignmentMethod,
    estimatedErrorMeters: candidate?.estimatedErrorMeters,
    warning,
    reviewMaterials: {
      mapImage: material?.mapImage,
      mapUrl: specificMapUrl,
      parcelOverlay: material?.parcelOverlay,
      overlayUrl: material?.overlayUrl,
      legendImage: material?.legendImage,
      legendUrl: specificLegendUrl,
      candidateOrdinances: candidates.map((item) => ({ code: item.identity, label: item.identity, evidence: item.documentaryEvidence })),
      precisionWarning: warning,
      sourceEvidence: [...new Set(candidates.flatMap((item) => [
        item.sourceRef,
        item.sourceDocument,
        ...item.provenance,
        ...(item.reviewMaterials?.sourceEvidence ?? []),
      ].filter((value): value is string => Boolean(value))))],
    },
    confirmationSource: 'automatic',
    contextualCandidates: contextualCandidates.length > 0 ? contextualCandidates : undefined,
  }
  
  if (hasEligibilitySignal) metadata.hasEligibility = hasEligibilitySignal
  
  return metadata
}

/** Capabilities documents establish provenance, but are not reviewable map or
 * legend material.  Only pass through an explicitly specific visual resource. */
function specificVisualUrl(value: string | undefined) {
  if (!value || /getcapabilities/i.test(value)) return undefined
  return /getmap|getlegendgraphic|\.(?:png|jpe?g|tiff?|pdf)(?:$|[?#])/i.test(value)
    ? value
    : undefined
}

function reviewMetadata(planning: PlanningApplicability | undefined, candidates: OrdinanceCandidate[]): OrdinanceResolutionMetadata {
  const sourceEvidence = [
    ...(planning?.documents?.map((document) => document.sourceUrl) ?? []),
    ...(planning?.evidence?.map((item) => item.sourceUrl) ?? []),
    planning?.resources?.wfsCapabilitiesUrl,
    planning?.resources?.wmsCapabilitiesUrl,
    planning?.resources?.detailedPlanningLayer,
    planning?.resources?.planningTileIndex,
  ].filter(Boolean)
  const specificSources = sourceEvidence.filter((value): value is string => typeof value === 'string')
  const mapDocument = planning?.documents?.find((document) =>
    document.documentType === 'sheet' && !/cat[aá]logo|ficha|patrimonio/i.test(document.title),
  ) ?? planning?.documents?.find((document) =>
    /(?:p\.\s*ord|plano|ordenaci[oó]n|n[uú]cleo|suelo urbano)/i.test(document.title) &&
    !/cat[aá]logo|ficha|patrimonio|memoria|normativa/i.test(document.title) &&
    /\d+(?:pb|nr|su|ot)\d+\.(?:png|jpe?g|tiff?)(?:$|[?#])/i.test(document.sourceUrl),
  )
  const mapUrl = mapDocument?.sourceUrl ?? specificSources.find((value) =>
    specificVisualUrl(value) &&
    !/getlegendgraphic/i.test(value) &&
    !/cat[aá]logo|ficha|patrimonio|memoria|normativa/i.test(value) &&
    /\d+(?:pb|nr|su|ot)\d+\.(?:png|jpe?g|tiff?)(?:$|[?#])/i.test(value),
  )
  const legendLayer = planning?.resources?.detailedPlanningLayer ?? planning?.resources?.planningTileIndex
  const municipalityCode = planning?.resources?.municipalityCode
  const discoveredLegendUrl = legendLayer && municipalityCode
    ? (() => {
        const legend = new URL('https://siotuga.xunta.gal/siotuga/ws')
        legend.search = new URLSearchParams({
          codine: municipalityCode,
          SERVICE: 'WMS',
          VERSION: '1.1.1',
          REQUEST: 'GetLegendGraphic',
          FORMAT: 'image/png',
          LAYER: legendLayer ?? '',
        }).toString()
        return legend.toString()
      })()
    : undefined
  const legendUrl = specificSources.find((value) => /getlegendgraphic/i.test(value) && !/getcapabilities/i.test(value)) ?? discoveredLegendUrl
  return {
    status: 'REVIEW_REQUIRED',
    confidence: 'unknown',
    provenance: [...new Set(specificSources)],
    reviewMaterials: {
      mapUrl,
      legendUrl,
      candidateOrdinances: candidates.map((item) => ({ code: item.identity, label: item.identity, evidence: item.documentaryEvidence })),
      sourceEvidence: [...new Set(specificSources)],
    },
  }
}

export async function resolveOrdinanceCandidates(
  planning: PlanningApplicability,
  options: Parameters<typeof resolveOrdinanceCandidatesDetailed>[1] = {}
): Promise<OrdinanceCandidate[]> {
  return (await resolveOrdinanceCandidatesDetailed(planning, options)).candidates
}

