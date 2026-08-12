import type { NormalizedParcelContext, ParcelContextField } from '@/domain/parcel-context/types'
import type {
  TerritorialFactualContract,
  FactDeterminationType,
  FactualCategory,
  FactualAffect,
  FactualProvenance,
  FactualCandidate,
  FactualAffectsState,
  FactualClassification,
  FactualConsolidation,
  FactualPlanningArea,
  FactualScopeFacts,
} from '@/domain/parcel-context/factualContract'
import type {
  UrbanisticFactStatus,
  UrbanisticFactOrigin,
  UrbanisticFact,
  UrbanisticFactCandidate,
  UrbanisticRegimeFacts,
} from '@/domain/territorial-resolver/types'
import type { SemanticCompleteness } from '@/domain/parcel-context/factualContract'

function semanticCompletenessFor(code?: string, label?: string): SemanticCompleteness | undefined {
  if (code === undefined || code === null) return undefined
  if (label !== undefined && label.trim().length > 0) return 'complete'
  return 'partial'
}

function mapDetermination(origin?: UrbanisticFactOrigin, status?: UrbanisticFactStatus | 'unresolved'): FactDeterminationType {
  if (status === 'unresolved' || status === 'not_available' || status === 'source_unavailable' || status === 'not_applicable') return 'unresolved'

  if (origin === 'technician_selection' || origin === 'technician_confirmation') {
    return status === 'technician_validated' ? 'effective' : 'manual'
  }

  if (origin === 'automatic_source' || origin === 'spatial_intersection' || origin === 'structured_catalog' || origin === 'conditional_scenario') {
    return status === 'automatic_confirmed' || status === 'automatic_probable' ? 'automatic' : 'unresolved'
  }

  if (status === 'technician_validated') return 'effective'
  if (status === 'automatic_confirmed') return 'automatic'
  if (status === 'conflict') return 'unresolved'

  return 'unresolved'
}

function buildProvenance(fact: UrbanisticFact<any>): FactualProvenance | undefined {
  if (fact.origin === 'technician_selection' || fact.origin === 'technician_confirmation') {
    return {
      sourceType: 'manual',
      resolvedAt: fact.resolvedAt,
    }
  }

  const ev = fact.evidence?.[0]
  if (!ev) return undefined

  return {
    sourceName: ev.source,
    sourceType: ev.source,
    evidence: ev.method,
    resolvedAt: fact.resolvedAt ?? ev.retrievedAt,
    confidence: fact.confidence,
    applicability: ev.scope,
  }
}

function buildAffects(constraints: ParcelContextField<string>[], context: NormalizedParcelContext): FactualAffectsState {
  const items: FactualAffect[] = constraints.map((constraint) => {
    let determination: FactDeterminationType = 'unresolved'
    if (constraint.verification === 'confirmed') determination = 'effective'
    else if (constraint.verification === 'inferred') determination = 'automatic'

    return {
      label: constraint.value,
      status: constraint.verification === 'confirmed' ? 'automatic_confirmed' : 'manual_review_required',
      determination,
      provenance: {
        sourceName: constraint.source,
        sourceType: constraint.source,
        evidence: constraint.evidence,
        confidence: constraint.confidence,
      },
    }
  })

  // Deduplicate by label
  const uniqueItems = Array.from(new Map(items.map((item) => [item.label, item])).values())

  const hasSourceIssues = context.reliability?.sourceIssues?.some((i) => i.toLowerCase().includes('afeccion') || i.toLowerCase().includes('affect'))

  // If there are issues, or no constraints found, or pending validations specifically mention affects.
  // Actually, if uniqueItems > 0, we can say it's 'checked' (even if partial, we have some).
  // If 0, and there are source issues or pending validation mentions it, it's unresolved.
  let status: 'unresolved' | 'checked' | 'conflict' = 'checked'

  if (uniqueItems.length === 0) {
    if (hasSourceIssues || context.pendingValidation.some((p) => p.toLowerCase().includes('afeccion') || p.toLowerCase().includes('affect'))) {
      status = 'unresolved'
    } else if (context.reliability?.mode === 'unresolved') {
      status = 'unresolved'
    } else {
      status = 'checked' // checked and found empty
    }
  }

  return {
    status,
    items: uniqueItems,
  }
}

function mapCandidate<T>(c: UrbanisticFactCandidate<T>): FactualCandidate {
  const code = (c.value as any)?.code ?? String(c.value)
  const label = c.label ?? (c.value as any)?.label
  return {
    code,
    label,
    semanticCompleteness: semanticCompletenessFor(code, label),
    parcelPercentage: c.parcelPercentage,
    intersectionAreaSquareMetres: c.intersectionAreaSquareMetres,
  }
}

function buildClassification(facts: UrbanisticRegimeFacts): FactualClassification {
  const classification = facts.classification

  return {
    code: classification.value?.code,
    label: classification.label ?? classification.value?.label,
    semanticCompleteness: semanticCompletenessFor(classification.value?.code, classification.label ?? classification.value?.label),
    status: classification.status,
    determination: mapDetermination(classification.origin, classification.status),
    provenance: buildProvenance(classification),
    candidates: classification.status === 'conflict' && classification.candidates ? classification.candidates.map(mapCandidate) : undefined,
  }
}

function buildCategories(facts: UrbanisticRegimeFacts): FactualCategory[] {
  const category = facts.category
  const categories: FactualCategory[] = []

  if (category.status === 'conflict' && category.candidates && category.candidates.length > 0) {
    for (const candidate of category.candidates) {
      const code = candidate.value.code
      const label = candidate.label ?? candidate.value.label
      categories.push({
        code,
        label,
        semanticCompleteness: semanticCompletenessFor(code, label),
        status: category.status,
        determination: mapDetermination(category.origin, category.status),
        parcelPercentage: candidate.parcelPercentage,
        intersectionAreaSquareMetres: candidate.intersectionAreaSquareMetres,
        provenance: buildProvenance(category),
      })
    }
  } else if (category.value?.code) {
    const code = category.value.code
    const label = category.label ?? category.value.label
    categories.push({
      code,
      label,
      semanticCompleteness: semanticCompletenessFor(code, label),
      status: category.status,
      determination: mapDetermination(category.origin, category.status),
      provenance: buildProvenance(category),
    })
  }

  return categories
}

function buildConsolidation(facts: UrbanisticRegimeFacts): FactualConsolidation {
  const consolidation = facts.consolidation
  const code = consolidation.value?.code ? String(consolidation.value.code) : undefined
  const label = consolidation.label ?? consolidation.value?.label

  return {
    code,
    label,
    semanticCompleteness: semanticCompletenessFor(code, label),
    status: consolidation.status,
    determination: mapDetermination(consolidation.origin, consolidation.status),
    provenance: buildProvenance(consolidation),
  }
}

function buildPlanningAreas(planningArea?: ParcelContextField<string>): FactualPlanningArea[] | undefined {
  if (!planningArea) return undefined

  return [
    {
      code: planningArea.value,
      semanticCompleteness: semanticCompletenessFor(planningArea.value, undefined),
      status: 'automatic_confirmed',
      determination: 'automatic',
      provenance: { sourceType: planningArea.source },
    },
  ]
}

interface BuildScopeFactsInput {
  urbanisticFacts?: UrbanisticRegimeFacts
  planningArea?: ParcelContextField<string>
  constraints?: ParcelContextField<string>[]
  context: NormalizedParcelContext
}

function buildScopeFacts({ urbanisticFacts, planningArea, constraints, context }: BuildScopeFactsInput): FactualScopeFacts | undefined {
  if (!urbanisticFacts && !planningArea && constraints === undefined) return undefined

  return {
    classification: urbanisticFacts ? buildClassification(urbanisticFacts) : undefined,
    categories: urbanisticFacts ? buildCategories(urbanisticFacts) : undefined,
    consolidation: urbanisticFacts ? buildConsolidation(urbanisticFacts) : undefined,
    planningAreas: buildPlanningAreas(planningArea),
    affects: constraints !== undefined ? buildAffects(constraints, context) : undefined,
  }
}

export function buildTerritorialFactualContract(context: NormalizedParcelContext): TerritorialFactualContract {
  const parcelFacts = context.parcelUrbanisticFacts ?? (context.actionArea ? undefined : context.urbanisticFacts)
  const parcelConstraints = context.actionArea ? context.parcelKnownConstraints : (context.parcelKnownConstraints ?? context.knownConstraints)
  // NormalizedParcelContext does not retain a parcel planningArea once an action area replaces it.
  const parcelPlanningArea = context.actionArea ? undefined : context.planningArea

  const factsByScope = {
    parcel: buildScopeFacts({
      urbanisticFacts: parcelFacts,
      planningArea: parcelPlanningArea,
      constraints: parcelConstraints,
      context,
    }),
    actionArea: context.actionArea
      ? buildScopeFacts({
          urbanisticFacts: context.urbanisticFacts,
          planningArea: context.planningArea,
          constraints: context.knownConstraints,
          context,
        })
      : undefined,
  }

  const activeFacts = context.actionArea ? factsByScope.actionArea : factsByScope.parcel
  const legacyClassification: FactualClassification = activeFacts?.classification ?? {
    status: 'unresolved',
    determination: 'unresolved',
  }
  const legacyConsolidation: FactualConsolidation = activeFacts?.consolidation ?? {
    status: 'unresolved',
    determination: 'unresolved',
  }
  const legacyAffects = buildAffects([...context.knownConstraints, ...(context.parcelKnownConstraints ?? [])], context)

  return {
    identity: {
      municipalityName: context.municipality?.value.name,
      municipalityCode: context.municipality?.value.ineCode,
      cadastralReference: context.cadastralReference?.value,
      address: context.address?.value,
      coordinates: context.coordinates?.value,
    },
    scopes: {
      parcel:
        context.parcelSurfaceSquareMetres !== undefined || context.parcelGeometry
          ? {
              areaSquareMetres: context.parcelSurfaceSquareMetres,
              hasGeometry: !!context.parcelGeometry,
              source: 'catastro', // Catastro is the official source of the parcel geometry in our domain
            }
          : undefined,
      actionArea: context.actionArea
        ? {
            areaSquareMetres: context.actionArea.value.surfaceSquareMetres,
            hasGeometry: !!context.actionArea.value.geometry,
            source: context.actionArea.value.source,
          }
        : undefined,
    },
    factsByScope,
    classification: legacyClassification,
    categories: activeFacts?.categories ?? [],
    consolidation: legacyConsolidation,
    planningAreas: activeFacts?.planningAreas ?? [],
    affects: legacyAffects,
    normativeReferences: {
      planningInstrument: context.planningInstrument?.value,
    },
  }
}
