import type {
  NormalizedParcelContext,
  ParcelRegimeGeometryScope,
  ParcelRegimeIdentity,
  ParcelRegimeIdentityScope,
  ParcelRegimeIdentityStatus,
} from '@/domain/parcel-context/types'
import type {
  UrbanisticFact,
  UrbanisticRegimeFacts,
} from '@/domain/territorial-resolver/types'

function factStatus(fact: UrbanisticFact<unknown> | undefined): ParcelRegimeIdentityStatus {
  switch (fact?.status) {
    case 'technician_validated':
      return 'effective'
    case 'automatic_confirmed':
      return 'automatic'
    case 'automatic_probable':
    case 'manual_review_required':
      return 'review'
    case 'conflict':
      return 'conflict'
    case 'not_available':
    case 'source_unavailable':
    case 'not_applicable':
    default:
      return 'unresolved'
  }
}

function rank(status: ParcelRegimeIdentityStatus) {
  return {
    effective: 0,
    automatic: 1,
    review: 2,
    conflict: 3,
    unresolved: 4,
  }[status]
}

function combineStatus(statuses: ParcelRegimeIdentityStatus[]): ParcelRegimeIdentityStatus {
  return [...statuses].sort((left, right) => rank(right) - rank(left))[0] ?? 'unresolved'
}

function confidence(facts: UrbanisticRegimeFacts, context: NormalizedParcelContext) {
  const values = [
    facts.classification.confidence,
    facts.category.confidence,
    context.landClass?.confidence,
    context.qualification?.confidence,
    context.planningArea?.confidence,
  ].filter((value): value is number | 'unknown' => value !== undefined)
  if (values.length === 0 || values.includes('unknown')) return 'unknown' as const
  return Math.min(...values.map((value) => typeof value === 'number' ? value : 0))
}

function geometryScope(context: NormalizedParcelContext, scope: 'parcel' | 'action_area'): ParcelRegimeGeometryScope {
  if (scope === 'action_area') {
    return context.actionArea?.value.selectionType === 'whole_parcel' ? 'whole_parcel' : 'action_area'
  }
  return context.parcelGeometry ? 'whole_parcel' : 'unknown'
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))]
}

function factEvidence(facts: UrbanisticRegimeFacts) {
  return [...new Map(
    [...facts.classification.evidence, ...facts.category.evidence, ...facts.consolidation.evidence].map((item) => [
      `${item.source}|${item.sourceUrl}|${item.retrievedAt}|${item.method}|${item.scope ?? ''}`,
      item,
    ])
  ).values()]
}

function automaticCandidates(facts: UrbanisticRegimeFacts) {
  return (facts.category.candidates ?? []).map((candidate) => ({
    code: candidate.value.code,
    label: candidate.label ?? candidate.value.label,
    parcelPercentage: candidate.parcelPercentage,
    intersectionAreaSquareMetres: candidate.intersectionAreaSquareMetres,
  }))
}

function deriveScope(
  context: NormalizedParcelContext,
  facts: UrbanisticRegimeFacts,
  scope: 'parcel' | 'action_area'
): ParcelRegimeIdentityScope[] {
  const categories = facts.category.candidates?.length && facts.category.candidates.length > 1
    ? facts.category.candidates
    : facts.category.value
      ? [{
          value: facts.category.value,
          label: facts.category.label,
          parcelPercentage: undefined,
          intersectionAreaSquareMetres: undefined,
        }]
      : []
  const categoryValues = categories.length > 0 ? categories : [undefined]
  const contextConflicts = context.conflicts
    .filter((conflict) => ['landClass', 'qualification', 'planningArea', 'planning'].includes(conflict.field))
    .map((conflict) => conflict.reason)
  const fieldStatus = [factStatus(facts.classification), factStatus(facts.category)] as ParcelRegimeIdentityStatus[]
  const regimeFields = [context.qualification, context.planningArea, context.ordinanceCandidates?.length ? { verification: 'confirmed', source: 'catastro' } : undefined].filter(Boolean)
  if (regimeFields.length === 0) {
    fieldStatus.push('unresolved')
  } else if (regimeFields.some((field) => field?.verification !== 'confirmed')) {
    fieldStatus.push('review')
  } else if (regimeFields.some((field) => field?.source === 'manual')) {
    fieldStatus.push('effective')
  } else {
    fieldStatus.push('automatic')
  }
  const baseStatus = combineStatus(fieldStatus)
  const provenance = unique([
    facts.classification.origin ?? '',
    facts.category.origin ?? '',
    context.landClass?.source ?? '',
    context.qualification?.source ?? '',
    context.planningArea?.source ?? '',
  ])
  const evidence = factEvidence(facts)
  const automatic = automaticCandidates(facts)

  return categoryValues.map((category) => {
    const conflicts = [...contextConflicts, ...facts.classification.discrepancies.map((item) => item.explanation), ...facts.category.discrepancies.map((item) => item.explanation)]
    let status = baseStatus
    if (context.qualification && context.planningArea && context.qualification.source !== context.planningArea.source) {
      status = status === 'conflict' ? status : 'review'
      conflicts.push('La ordenanza/calificación y el ámbito proceden de decisiones o fuentes distintas.')
    }
    if (conflicts.length > 0 && status !== 'unresolved') status = status === 'conflict' ? status : 'review'
    return {
      scope,
      classification: facts.classification.value
        ? { code: facts.classification.value.code, label: facts.classification.label ?? facts.classification.value.label }
        : undefined,
      category: category?.value
        ? {
            code: category.value.code,
            label: category.label ?? category.value.label,
            parcelPercentage: category.parcelPercentage,
            intersectionAreaSquareMetres: category.intersectionAreaSquareMetres,
          }
        : undefined,
      qualification: context.qualification?.value,
      ordinances: context.ordinanceCandidates,
      planningArea: context.planningArea?.value,
      instrumentId: facts.classification.instrumentId ?? facts.category.instrumentId,
      status,
      confidence: confidence(facts, context),
      geometryScope: geometryScope(context, scope),
      provenance,
      evidence,
      conflicts: unique(conflicts),
      automaticCandidates: automatic.length > 0 ? automatic : undefined,
    }
  })
}

function deriveFieldOnlyScope(context: NormalizedParcelContext): ParcelRegimeIdentityScope | undefined {
  if (!context.landClass && !context.qualification && !context.planningArea && !context.ordinanceCandidates?.length) return undefined
  const fields = [context.landClass, context.qualification, context.planningArea].filter(Boolean)
  const conflicts = context.conflicts
    .filter((conflict) => ['landClass', 'qualification', 'planningArea', 'planning'].includes(conflict.field))
    .map((conflict) => conflict.reason)
  const hasUnverified = fields.some((field) => field?.verification !== 'confirmed')
  const allConfirmed = fields.every((field) => field?.verification === 'confirmed')
  const manualConfirmed = fields.some((field) => field?.source === 'manual') && allConfirmed
  const hasRegimeQualifier = Boolean(context.qualification || context.planningArea || context.ordinanceCandidates?.length)
  const status: ParcelRegimeIdentityStatus = conflicts.length > 0
    ? 'conflict'
    : !hasRegimeQualifier
      ? 'unresolved'
    : hasUnverified
      ? 'review'
      : manualConfirmed
        ? 'effective'
        : 'automatic'
  return {
    scope: context.actionArea ? 'action_area' : 'parcel',
    classification: context.landClass ? { code: context.landClass.value, label: context.landClass.value } : undefined,
    qualification: context.qualification?.value,
    ordinances: context.ordinanceCandidates,
    planningArea: context.planningArea?.value,
    status,
    confidence: fields.length > 0 ? Math.min(...fields.map((field) => field!.confidence)) : 'unknown',
    geometryScope: geometryScope(context, context.actionArea ? 'action_area' : 'parcel'),
    provenance: unique(fields.map((field) => field!.source)),
    evidence: [],
    conflicts: unique(conflicts),
  }
}

export function deriveParcelRegimeIdentity(context: NormalizedParcelContext): ParcelRegimeIdentity {
  const scopes: ParcelRegimeIdentityScope[] = []
  const parcelFacts = context.actionArea ? context.parcelUrbanisticFacts : (context.parcelUrbanisticFacts ?? context.urbanisticFacts)
  if (parcelFacts) scopes.push(...deriveScope(context, parcelFacts, 'parcel'))
  if (context.actionArea && context.urbanisticFacts) scopes.push(...deriveScope(context, context.urbanisticFacts, 'action_area'))
  if (scopes.length === 0) {
    const fieldOnly = deriveFieldOnlyScope(context)
    if (fieldOnly) scopes.push(fieldOnly)
  }

  const statuses = scopes.map((scope) => scope.status)
  const status = scopes.length > 1 ? 'review' : combineStatus(statuses)
  return {
    scopes,
    status,
    confidence: scopes.length === 0 || scopes.some((scope) => scope.confidence === 'unknown')
      ? 'unknown'
      : Math.min(...scopes.map((scope) => scope.confidence as number)),
    provenance: unique(scopes.flatMap((scope) => scope.provenance)),
    evidence: [...new Map(scopes.flatMap((scope) => scope.evidence).map((item) => [
      `${item.source}|${item.sourceUrl}|${item.retrievedAt}|${item.method}`,
      item,
    ])).values()],
    conflicts: unique(scopes.flatMap((scope) => scope.conflicts)),
  }
}
