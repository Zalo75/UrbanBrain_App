/**
 * Pure resolution of detailed planning regimes from normalized, traceable
 * evidence. This module deliberately has no provider, municipality, storage,
 * GIS, retrieval, or UI dependency.
 */

export type PlanningRegimeDeterminationType =
  | 'ordinance'
  | 'zoning_rule'
  | 'planning_unit'
  | 'planning_sheet'
  | 'special_plan'
  | 'planning_amendment'
  | 'detailed_regime'
  | 'other'

export type PlanningRegimeEvidenceType =
  | 'official_vector'
  | 'official_document'
  | 'official_raster'
  | 'instrument_hierarchy'
  | 'derived_spatial'
  | 'reviewed_knowledge'
  | 'technician_decision'
  | 'learned_candidate'

export type PlanningRegimeResolutionStatus =
  | 'not_started'
  | 'evidence_insufficient'
  | 'candidate'
  | 'corroborated'
  | 'officially_confirmed'
  | 'technician_validated'
  | 'multiple_applicable'
  | 'review_required'
  | 'conflict'
  | 'superseded'
  | 'revoked'

export type PlanningRegimeConfidence = 'high' | 'medium' | 'low' | 'unknown'
export type PlanningRegimeProvenance = 'official' | 'reviewed_knowledge' | 'technician' | 'learned'
export type PlanningRegimeVerification = 'unverified' | 'verified' | 'technician_validated' | 'revoked'
export type SpatialApplicability = 'confirmed' | 'unknown' | 'not_applicable'
export type DeterminationRelation = 'exclusive' | 'accumulative'

export interface PlanningRegimeValue {
  code: string
  label?: string
}

export type PlanningRegimeEntityKind =
  | 'action_area'
  | 'geometry'
  | 'planning_unit'
  | 'planning_sheet'
  | 'planning_zone'
  | 'detailed_regime'
  | 'instrument'
  | 'other'

export interface PlanningRegimeEntity {
  kind: PlanningRegimeEntityKind
  id: string
}

export type PlanningRegimePredicate =
  | 'belongs_to'
  | 'governed_by'
  | 'applies_to'
  | 'part_of'
  | 'not_belongs_to'
  | 'not_applies_to'

export interface PlanningRegimeAssertion {
  subject: PlanningRegimeEntity
  predicate: PlanningRegimePredicate
  object: PlanningRegimeEntity
}

/** Scope remains provider-neutral; geometry is retained only for traceability. */
export interface PlanningRegimeSpatialScope {
  scopeKey: string
  geometry?: unknown
  geometryReference?: string
  relationToSubject?: 'same' | 'within'
}

export interface PlanningRegimeOfficialReference {
  kind: 'document' | 'vector_attribute' | 'planning_sheet' | 'structured_record'
  id: string
  locator: string
}

export interface PlanningRegimeEvidence {
  id: string
  evidenceType: PlanningRegimeEvidenceType
  determination?: {
    type: PlanningRegimeDeterminationType
    value: PlanningRegimeValue
    relation: DeterminationRelation
    /** Only values in the same group can conflict because they are exclusive. */
    exclusivityGroup: string
  }
  assertion?: PlanningRegimeAssertion
  source: string
  officialSourceId?: string
  provider?: string
  instrumentId?: string
  instrumentVersion?: string
  validFrom?: string
  validTo?: string
  spatialScope?: PlanningRegimeSpatialScope
  officialReference?: PlanningRegimeOfficialReference
  verification: PlanningRegimeVerification
  provenance: PlanningRegimeProvenance
  observedAt: string
  explicitRelation?: boolean
  spatialApplicability?: SpatialApplicability
  /** Kept only for compatibility with already normalized inputs; never authoritative alone. */
  officialSourceVerifiable?: boolean
  current?: boolean
}

export type PlanningRegimeDependencyKey =
  | 'geometry_snapshot'
  | 'action_area'
  | 'instrument'
  | 'instrument_version'
  | 'validity_reference'
  | 'planning_area'
  | 'planning_unit'
  | 'planning_sheet'
  | 'official_evidence'
  | 'technician_decision'

export interface PlanningRegimeDependency {
  key: PlanningRegimeDependencyKey
  value: string
}

export interface PlanningRegimeResolutionInput {
  resolutionId: string
  createdAt: string
  referenceDate: string
  subject: PlanningRegimeEntity
  spatialScope: PlanningRegimeSpatialScope
  evidence: PlanningRegimeEvidence[]
  dependencies: PlanningRegimeDependency[]
  supersedesResolutionId?: string
}

export interface PlanningRegimeDetermination {
  determinationType: PlanningRegimeDeterminationType
  proposedValue: PlanningRegimeValue
  effectiveValue?: PlanningRegimeValue
  relation: DeterminationRelation
  exclusivityGroup: string
  status: PlanningRegimeResolutionStatus
  confidence: PlanningRegimeConfidence
  provenance: PlanningRegimeProvenance
  spatialScope?: PlanningRegimeSpatialScope
  acceptedEvidence: PlanningRegimeEvidence[]
  rejectedEvidence: PlanningRegimeEvidence[]
  rejectionReasons: string[]
  pendingEvidence: PlanningRegimeEvidence[]
  invalidationDependencies: PlanningRegimeDependency[]
}

export interface PlanningRegimeResolution {
  resolutionId: string
  createdAt: string
  referenceDate: string
  subject: PlanningRegimeEntity
  spatialScope: PlanningRegimeSpatialScope
  status: PlanningRegimeResolutionStatus
  determinations: PlanningRegimeDetermination[]
  reason: string
  requiresTechnicalConfirmation: boolean
  canConstrainNormativeSearch: boolean
  supersedesResolutionId?: string
  dependencies: PlanningRegimeDependency[]
}

export type PlanningRegimeDependencyChangeKind = 'changed' | 'added' | 'removed' | 'missing_required'

export interface PlanningRegimeDependencyChange {
  key: PlanningRegimeDependencyKey
  kind: PlanningRegimeDependencyChangeKind
  previousValue?: string
  currentValue?: string
}

export interface PlanningRegimeCurrentness {
  current: boolean
  fullyValid: boolean
  changes: PlanningRegimeDependencyChange[]
}

const TRANSITIONS: Readonly<Record<PlanningRegimeResolutionStatus, readonly PlanningRegimeResolutionStatus[]>> = {
  not_started: ['evidence_insufficient', 'candidate', 'corroborated', 'officially_confirmed', 'technician_validated', 'multiple_applicable', 'review_required', 'conflict'],
  evidence_insufficient: ['candidate', 'corroborated', 'officially_confirmed', 'technician_validated', 'review_required', 'superseded'],
  candidate: ['corroborated', 'officially_confirmed', 'technician_validated', 'review_required', 'conflict', 'superseded', 'revoked'],
  corroborated: ['officially_confirmed', 'technician_validated', 'review_required', 'conflict', 'superseded', 'revoked'],
  officially_confirmed: ['multiple_applicable', 'conflict', 'superseded', 'revoked'],
  technician_validated: ['officially_confirmed', 'multiple_applicable', 'conflict', 'superseded', 'revoked'],
  multiple_applicable: ['officially_confirmed', 'technician_validated', 'review_required', 'conflict', 'superseded', 'revoked'],
  review_required: ['candidate', 'corroborated', 'officially_confirmed', 'technician_validated', 'conflict', 'superseded', 'revoked'],
  conflict: ['candidate', 'corroborated', 'officially_confirmed', 'technician_validated', 'review_required', 'superseded', 'revoked'],
  superseded: [],
  revoked: ['candidate', 'corroborated', 'officially_confirmed', 'technician_validated', 'review_required', 'superseded'],
}

export function canTransitionPlanningRegimeResolution(
  from: PlanningRegimeResolutionStatus,
  to: PlanningRegimeResolutionStatus
) {
  return TRANSITIONS[from].includes(to)
}

function entityKey(entity: PlanningRegimeEntity) {
  return `${entity.kind}|${entity.id}`
}

function sameEntity(left: PlanningRegimeEntity, right: PlanningRegimeEntity) {
  return entityKey(left) === entityKey(right)
}

function isDateCompatible(evidence: PlanningRegimeEvidence, referenceDate: string) {
  const reference = Date.parse(referenceDate)
  const validFrom = evidence.validFrom ? Date.parse(evidence.validFrom) : Number.NaN
  const validTo = evidence.validTo ? Date.parse(evidence.validTo) : Number.NaN
  if (Number.isNaN(reference) || Number.isNaN(validFrom)) return false
  if (reference < validFrom) return false
  return Number.isNaN(validTo) || reference <= validTo
}

function isActive(evidence: PlanningRegimeEvidence, referenceDate: string) {
  return evidence.current !== false && evidence.verification !== 'revoked' && isDateCompatible(evidence, referenceDate)
}

function hasIdentifiableOfficialReference(evidence: PlanningRegimeEvidence) {
  const reference = evidence.officialReference
  return Boolean(reference?.id.trim() && reference.locator.trim())
}

function hasOfficialChainMetadata(evidence: PlanningRegimeEvidence, referenceDate: string) {
  return Boolean(
    evidence.officialSourceId?.trim() &&
      evidence.instrumentId?.trim() &&
      evidence.instrumentVersion?.trim() &&
      evidence.explicitRelation === true &&
      evidence.verification === 'verified' &&
      hasIdentifiableOfficialReference(evidence) &&
      isActive(evidence, referenceDate)
  )
}

function canBeOfficialChainEdge(evidence: PlanningRegimeEvidence, referenceDate: string) {
  if (!hasOfficialChainMetadata(evidence, referenceDate)) return false
  return (
    evidence.evidenceType === 'official_vector' ||
    evidence.evidenceType === 'official_document' ||
    evidence.evidenceType === 'instrument_hierarchy' ||
    evidence.evidenceType === 'reviewed_knowledge'
  )
}

function isTechnicianValidated(evidence: PlanningRegimeEvidence, referenceDate: string) {
  return (
    isActive(evidence, referenceDate) &&
    evidence.evidenceType === 'technician_decision' &&
    evidence.verification === 'technician_validated'
  )
}

function isPositivePathPredicate(predicate: PlanningRegimePredicate) {
  return predicate === 'belongs_to' || predicate === 'part_of' || predicate === 'applies_to'
}

function isInstrumentCompatible(
  evidence: PlanningRegimeEvidence,
  dependencies: PlanningRegimeDependency[]
) {
  const instrument = dependencies.find((dependency) => dependency.key === 'instrument')?.value
  const version = dependencies.find((dependency) => dependency.key === 'instrument_version')?.value
  return Boolean(
    instrument &&
      version &&
      evidence.instrumentId === instrument &&
      evidence.instrumentVersion === version
  )
}

function isScopeCompatibleWithInput(
  scope: PlanningRegimeSpatialScope | undefined,
  input: PlanningRegimeResolutionInput
) {
  return Boolean(
    scope &&
      (scope.scopeKey === input.spatialScope.scopeKey || scope.relationToSubject === 'within')
  )
}

function chainForDetermination(
  evidence: PlanningRegimeEvidence,
  input: PlanningRegimeResolutionInput
) {
  const assertion = evidence.assertion
  if (
    !assertion ||
    assertion.predicate !== 'governed_by' ||
    assertion.object.id !== evidence.determination?.value.code ||
    !canBeOfficialChainEdge(evidence, input.referenceDate)
  ) {
    return {
      accepted: [] as PlanningRegimeEvidence[],
      rejected: [] as PlanningRegimeEvidence[],
      reasons: ['La evidencia no contiene una relación oficial verificable entre la entidad territorial y la determinación propuesta.'],
      complete: false,
    }
  }
  const target = assertion.subject
  const eligible = input.evidence.filter(
    (item) => canBeOfficialChainEdge(item, input.referenceDate) && isInstrumentCompatible(item, input.dependencies)
  )
  const negative = input.evidence.filter(
    (item) =>
      item.assertion &&
      (item.assertion.predicate === 'not_belongs_to' || item.assertion.predicate === 'not_applies_to') &&
      sameEntity(item.assertion.subject, input.subject) &&
      sameEntity(item.assertion.object, target) &&
      isActive(item, input.referenceDate)
  )
  if (negative.length > 0) {
    return {
      accepted: [] as PlanningRegimeEvidence[],
      rejected: negative,
      reasons: ['La evidencia espacial oficial excluye el área de actuación de la entidad territorial que conecta con la determinación propuesta.'],
      complete: false,
    }
  }

  if (sameEntity(target, input.subject)) {
    const direct =
      evidence.spatialApplicability === 'confirmed' &&
      isInstrumentCompatible(evidence, input.dependencies) &&
      isScopeCompatibleWithInput(evidence.spatialScope, input)
    return {
      accepted: direct ? [evidence] : [],
      rejected: [] as PlanningRegimeEvidence[],
      reasons: direct ? [] : ['La relación oficial no acredita su aplicabilidad espacial al área de actuación.'],
      complete: direct,
    }
  }

  const queue: Array<{ node: PlanningRegimeEntity; path: PlanningRegimeEvidence[] }> = [{
    node: input.subject,
    path: [],
  }]
  const visited = new Set<string>([entityKey(input.subject)])
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const edge of eligible) {
      if (!edge.assertion || !isPositivePathPredicate(edge.assertion.predicate)) continue
      if (edge.spatialApplicability !== 'confirmed' || !sameEntity(edge.assertion.subject, current.node)) continue
      if (current.path.length === 0 && !isScopeCompatibleWithInput(edge.spatialScope, input)) continue
      const next = edge.assertion.object
      const path = [...current.path, edge]
      if (sameEntity(next, target)) {
        const hierarchy = eligible.find(
          (item) =>
            item.evidenceType === 'instrument_hierarchy' &&
            item.assertion?.predicate === 'part_of' &&
            sameEntity(item.assertion.subject, target) &&
            item.assertion.object.kind === 'instrument' &&
            item.assertion.object.id === evidence.instrumentId
        )
        return {
          accepted: hierarchy ? [...path, hierarchy, evidence] : [...path, evidence],
          rejected: [] as PlanningRegimeEvidence[],
          reasons: hierarchy ? [] : ['No existe una evidencia jerárquica oficial que vincule la entidad territorial con el instrumento vigente.'],
          complete: Boolean(hierarchy),
        }
      }
      const key = entityKey(next)
      if (!visited.has(key)) {
        visited.add(key)
        queue.push({ node: next, path })
      }
    }
  }
  return {
    accepted: [] as PlanningRegimeEvidence[],
    rejected: [] as PlanningRegimeEvidence[],
    reasons: ['No existe una cadena espacial oficial que conecte el área de actuación con la entidad territorial de la determinación.'],
    complete: false,
  }
}

function determinationIdentity(evidence: PlanningRegimeEvidence) {
  const determination = evidence.determination
  if (!determination) return undefined
  return [
    determination.type,
    determination.value.code.trim().toUpperCase(),
    evidence.spatialScope?.scopeKey ?? 'unscoped',
  ].join('|')
}

function distinct<T>(values: T[]) {
  return [...new Set(values)]
}

function hasMinimumDependencies(
  dependencies: PlanningRegimeDependency[],
  provenance: PlanningRegimeProvenance,
  referenceDate: string
) {
  const keys = new Set(dependencies.map((dependency) => dependency.key))
  const hasSpatialAnchor = keys.has('geometry_snapshot') || keys.has('action_area')
  const hasSourceDependency = provenance === 'technician'
    ? keys.has('technician_decision')
    : keys.has('official_evidence')
  return hasSpatialAnchor &&
    keys.has('instrument') &&
    keys.has('instrument_version') &&
    dependencies.some(
      (dependency) => dependency.key === 'validity_reference' && dependency.value === referenceDate
    ) &&
    hasSourceDependency
}

function provenanceFor(evidence: PlanningRegimeEvidence[], referenceDate: string): PlanningRegimeProvenance {
  if (evidence.some((item) => canBeOfficialChainEdge(item, referenceDate))) return 'official'
  if (evidence.some((item) => isTechnicianValidated(item, referenceDate))) return 'technician'
  if (evidence.some((item) => item.evidenceType === 'reviewed_knowledge')) return 'reviewed_knowledge'
  return 'learned'
}

function confidence(status: PlanningRegimeResolutionStatus): PlanningRegimeConfidence {
  if (status === 'officially_confirmed') return 'high'
  if (status === 'technician_validated' || status === 'corroborated') return 'medium'
  if (status === 'candidate') return 'low'
  return 'unknown'
}

export function assessPlanningRegimeResolutionCurrentness(
  resolution: Pick<PlanningRegimeResolution, 'dependencies' | 'status' | 'determinations' | 'referenceDate'>,
  currentDependencies: PlanningRegimeDependency[]
): PlanningRegimeCurrentness {
  const previous = new Map(resolution.dependencies.map((dependency) => [dependency.key, dependency.value]))
  const current = new Map(currentDependencies.map((dependency) => [dependency.key, dependency.value]))
  const changes: PlanningRegimeDependencyChange[] = []
  for (const [key, previousValue] of previous) {
    const currentValue = current.get(key)
    if (currentValue === undefined) changes.push({ key, kind: 'removed', previousValue })
    else if (currentValue !== previousValue) changes.push({ key, kind: 'changed', previousValue, currentValue })
  }
  for (const [key, currentValue] of current) {
    if (!previous.has(key)) changes.push({ key, kind: 'added', currentValue })
  }

  const effectiveProvenance = resolution.determinations.find(
    (item) => item.status === 'officially_confirmed' || item.status === 'technician_validated'
  )?.provenance
  if (effectiveProvenance && !hasMinimumDependencies(resolution.dependencies, effectiveProvenance, resolution.referenceDate)) {
    changes.push({ key: effectiveProvenance === 'technician' ? 'technician_decision' : 'official_evidence', kind: 'missing_required' })
  }
  if (effectiveProvenance && !hasMinimumDependencies(currentDependencies, effectiveProvenance, resolution.referenceDate)) {
    changes.push({ key: effectiveProvenance === 'technician' ? 'technician_decision' : 'official_evidence', kind: 'missing_required' })
  }
  const fullyValid = !changes.some((change) => change.kind === 'missing_required')
  return { current: changes.length === 0 && resolution.status !== 'superseded', fullyValid, changes }
}

/** Returns a new historical representation and never mutates the input resolution. */
export function supersedePlanningRegimeResolution(
  resolution: PlanningRegimeResolution,
  currentDependencies: PlanningRegimeDependency[]
): PlanningRegimeResolution {
  const currentness = assessPlanningRegimeResolutionCurrentness(resolution, currentDependencies)
  if (currentness.current) return resolution
  return {
    ...resolution,
    status: 'superseded',
    reason: `La resolución depende de datos que han cambiado o ya no son completos: ${currentness.changes.map((item) => item.key).join(', ')}.`,
    requiresTechnicalConfirmation: false,
    canConstrainNormativeSearch: false,
  }
}

export function resolvePlanningRegime(
  input: PlanningRegimeResolutionInput
): PlanningRegimeResolution {
  const determinedEvidence = input.evidence.filter(
    (item): item is PlanningRegimeEvidence & { determination: NonNullable<PlanningRegimeEvidence['determination']> } =>
      Boolean(item.determination)
  )
  if (determinedEvidence.length === 0) {
    return baseResolution(input, [], 'evidence_insufficient', 'No existen evidencias normalizadas que acrediten una determinación pormenorizada.')
  }

  const groups = new Map<string, typeof determinedEvidence>()
  for (const evidence of determinedEvidence) {
    const identity = determinationIdentity(evidence)!
    groups.set(identity, [...(groups.get(identity) ?? []), evidence])
  }

  const determinations = [...groups.values()].map((evidence): PlanningRegimeDetermination => {
    const first = evidence[0].determination
    const chains = evidence.map((item) => chainForDetermination(item, input))
    const chain =
      chains.find((item) => item.complete) ??
      chains.find((item) => item.rejected.length > 0) ??
      chains[0]
    const technician = evidence.find((item) => isTechnicianValidated(item, input.referenceDate))
    const official = chain.complete
    const provenance = official
      ? 'official'
      : technician
        ? 'technician'
        : provenanceFor(evidence, input.referenceDate)
    const hasDependencies = hasMinimumDependencies(input.dependencies, provenance, input.referenceDate)
    const corroboratingDocuments = evidence.filter(
      (item) => item.evidenceType === 'official_document' && item.explicitRelation && isActive(item, input.referenceDate)
    )
    const hasIncompleteOfficialEvidence = evidence.some(
      (item) => item.evidenceType !== 'learned_candidate' && item.evidenceType !== 'official_raster'
    )
    const status: PlanningRegimeResolutionStatus = official && hasDependencies
      ? 'officially_confirmed'
      : technician && hasDependencies
        ? 'technician_validated'
        : evidence.every((item) => item.verification === 'revoked')
          ? 'revoked'
          : corroboratingDocuments.length >= 2
            ? 'corroborated'
            : hasIncompleteOfficialEvidence
              ? 'review_required'
              : 'candidate'
    const acceptedEvidence = status === 'officially_confirmed'
      ? chain.accepted
      : status === 'technician_validated' && technician
        ? [technician]
        : []
    const rejectedEvidence = chain.rejected
    const pendingEvidence = evidence.filter(
      (item) => !acceptedEvidence.includes(item) && !rejectedEvidence.includes(item) && item.verification !== 'revoked'
    )
    return {
      determinationType: first.type,
      proposedValue: first.value,
      effectiveValue:
        status === 'officially_confirmed' || status === 'technician_validated'
          ? first.value
          : undefined,
      relation: first.relation,
      exclusivityGroup: first.exclusivityGroup,
      status,
      confidence: confidence(status),
      provenance,
      spatialScope: evidence[0].spatialScope,
      acceptedEvidence,
      rejectedEvidence,
      rejectionReasons: chain.reasons,
      pendingEvidence,
      invalidationDependencies: input.dependencies,
    }
  })

  const scopeGroups = new Map<string, PlanningRegimeDetermination[]>()
  for (const determination of determinations) {
    const scope = determination.spatialScope?.scopeKey ?? 'unscoped'
    scopeGroups.set(scope, [...(scopeGroups.get(scope) ?? []), determination])
  }
  const hasConflict = [...scopeGroups.values()].some((items) => {
    const exclusiveValuesByGroup = new Map<string, Set<string>>()
    for (const item of items.filter((item) => item.relation === 'exclusive')) {
      exclusiveValuesByGroup.set(
        item.exclusivityGroup,
        new Set([...(exclusiveValuesByGroup.get(item.exclusivityGroup) ?? []), item.proposedValue.code.toUpperCase()])
      )
    }
    return [...exclusiveValuesByGroup.values()].some((values) => values.size > 1)
  })
  if (hasConflict) {
    return baseResolution(input, determinations, 'conflict', 'Existen valores exclusivos incompatibles para el mismo alcance y grupo de exclusividad.')
  }

  const scopes = distinct(determinations.map((item) => item.spatialScope?.scopeKey ?? 'unscoped'))
  if (scopes.length > 1) {
    return baseResolution(input, determinations, 'multiple_applicable', 'Existen determinaciones aplicables a alcances espaciales diferentes.')
  }

  const statuses = distinct(determinations.map((item) => item.status))
  const status = statuses.every((item) => item === 'officially_confirmed')
    ? 'officially_confirmed'
    : statuses.every((item) => item === 'technician_validated')
      ? 'technician_validated'
      : statuses.every((item) => item === 'corroborated')
        ? 'corroborated'
        : statuses.every((item) => item === 'revoked')
          ? 'revoked'
          : statuses.some((item) => item === 'review_required' || item === 'corroborated')
            ? 'review_required'
            : 'candidate'
  const oneEffectiveDetermination = determinations.length === 1 &&
    (status === 'officially_confirmed' || status === 'technician_validated')
  return baseResolution(
    input,
    determinations,
    status,
    reasonForStatus(status),
    oneEffectiveDetermination
  )
}

function reasonForStatus(status: PlanningRegimeResolutionStatus) {
  switch (status) {
    case 'officially_confirmed':
      return 'Una cadena oficial explícita, vigente, compatible y espacialmente aplicable acredita la determinación.'
    case 'technician_validated':
      return 'Una determinación técnica validada hace efectivo el régimen para este alcance.'
    case 'corroborated':
      return 'Varias evidencias compatibles corroboran una determinación, pero no acreditan íntegramente su aplicabilidad.'
    case 'review_required':
      return 'Existe evidencia oficial o técnica incompleta que requiere comprobación antes de hacer efectivo el régimen.'
    case 'revoked':
      return 'Las determinaciones disponibles han sido revocadas y ya no son operativas.'
    case 'candidate':
      return 'Existe una determinación candidata que todavía no acredita una relación aplicable.'
    default:
      return 'No existe evidencia suficiente para resolver una determinación pormenorizada.'
  }
}

function baseResolution(
  input: PlanningRegimeResolutionInput,
  determinations: PlanningRegimeDetermination[],
  status: PlanningRegimeResolutionStatus,
  reason: string,
  canConstrainNormativeSearch = false
): PlanningRegimeResolution {
  return {
    resolutionId: input.resolutionId,
    createdAt: input.createdAt,
    referenceDate: input.referenceDate,
    subject: input.subject,
    spatialScope: input.spatialScope,
    status,
    determinations,
    reason,
    requiresTechnicalConfirmation: status === 'candidate' || status === 'corroborated' || status === 'review_required',
    canConstrainNormativeSearch,
    supersedesResolutionId: input.supersedesResolutionId,
    dependencies: input.dependencies,
  }
}
