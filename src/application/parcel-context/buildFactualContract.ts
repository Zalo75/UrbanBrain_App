import type { NormalizedParcelContext, ParcelContextField } from '@/domain/parcel-context/types'
import type { 
  TerritorialFactualContract, 
  FactDeterminationType,
  FactualCategory,
  FactualScope,
  FactualAffect,
  FactualProvenance,
  FactualCandidate,
  FactualAffectsState
} from '@/domain/parcel-context/factualContract'
import type { UrbanisticFactStatus, UrbanisticFactOrigin, UrbanisticFact, UrbanisticFactCandidate } from '@/domain/territorial-resolver/types'

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
    applicability: ev.scope
  }
}

function buildAffects(context: NormalizedParcelContext): FactualAffectsState {
  const allConstraints = [
    ...(context.knownConstraints || []),
    ...(context.parcelKnownConstraints || [])
  ]

  const items: FactualAffect[] = allConstraints.map(constraint => {
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
      }
    }
  })

  // Deduplicate by label
  const uniqueItems = Array.from(new Map(items.map(item => [item.label, item])).values())

  const hasSourceIssues = context.reliability?.sourceIssues?.some(i => i.toLowerCase().includes('afeccion') || i.toLowerCase().includes('affect'))
  
  // If there are issues, or no constraints found, or pending validations specifically mention affects.
  // Actually, if uniqueItems > 0, we can say it's 'checked' (even if partial, we have some).
  // If 0, and there are source issues or pending validation mentions it, it's unresolved.
  let status: 'unresolved' | 'checked' | 'conflict' = 'checked'
  
  if (uniqueItems.length === 0) {
    if (hasSourceIssues || context.pendingValidation.some(p => p.toLowerCase().includes('afeccion') || p.toLowerCase().includes('affect'))) {
      status = 'unresolved'
    } else if (context.reliability?.mode === 'unresolved') {
      status = 'unresolved'
    } else {
      status = 'checked' // checked and found empty
    }
  }

  return {
    status,
    items: uniqueItems
  }
}

function mapCandidate<T>(c: UrbanisticFactCandidate<T>): FactualCandidate {
  return {
    code: (c.value as any)?.code ?? String(c.value),
    label: c.label ?? (c.value as any)?.label,
    parcelPercentage: c.parcelPercentage,
    intersectionAreaSquareMetres: c.intersectionAreaSquareMetres
  }
}

export function buildTerritorialFactualContract(context: NormalizedParcelContext): TerritorialFactualContract {
  const uf = context.urbanisticFacts
  
  // Categories logic
  const categories: FactualCategory[] = []
  if (uf?.category) {
    if (uf.category.status === 'conflict' && uf.category.candidates && uf.category.candidates.length > 0) {
      for (const c of uf.category.candidates) {
        categories.push({
          code: c.value.code,
          label: c.label ?? c.value.label,
          status: uf.category.status,
          determination: mapDetermination(uf.category.origin, uf.category.status),
          parcelPercentage: c.parcelPercentage,
          intersectionAreaSquareMetres: c.intersectionAreaSquareMetres,
          provenance: buildProvenance(uf.category) // shared provenance for the conflict state
        })
      }
    } else if (uf.category.value?.code) {
      categories.push({
        code: uf.category.value.code,
        label: uf.category.label ?? uf.category.value.label,
        status: uf.category.status,
        determination: mapDetermination(uf.category.origin, uf.category.status),
        provenance: buildProvenance(uf.category)
      })
    }
  }

  const classification = uf?.classification
  const classStatus = classification?.status ?? 'unresolved'

  return {
    identity: {
      municipalityName: context.municipality?.value.name,
      municipalityCode: context.municipality?.value.ineCode,
      cadastralReference: context.cadastralReference?.value,
      address: context.address?.value,
      coordinates: context.coordinates?.value
    },
    scopes: {
      parcel: context.parcelSurfaceSquareMetres !== undefined || context.parcelGeometry ? {
        areaSquareMetres: context.parcelSurfaceSquareMetres,
        hasGeometry: !!context.parcelGeometry,
        source: 'catastro' // Catastro is the official source of the parcel geometry in our domain
      } : undefined,
      actionArea: context.actionArea ? {
        areaSquareMetres: context.actionArea.value.surfaceSquareMetres,
        hasGeometry: !!context.actionArea.value.geometry,
        source: context.actionArea.value.source
      } : undefined
    },
    classification: {
      code: classification?.value?.code,
      label: classification?.label ?? classification?.value?.label,
      status: classStatus,
      determination: mapDetermination(classification?.origin, classStatus),
      provenance: classification ? buildProvenance(classification) : undefined,
      candidates: classification?.status === 'conflict' && classification.candidates ? classification.candidates.map(mapCandidate) : undefined
    },
    categories,
    consolidation: {
      code: uf?.consolidation?.value?.code ? String(uf.consolidation.value.code) : undefined,
      label: uf?.consolidation?.label ?? uf?.consolidation?.value?.label,
      status: uf?.consolidation?.status ?? 'unresolved',
      determination: mapDetermination(uf?.consolidation?.origin, uf?.consolidation?.status ?? 'unresolved'),
      provenance: uf?.consolidation ? buildProvenance(uf.consolidation) : undefined
    },
    planningAreas: context.planningArea ? [{
      code: context.planningArea.value,
      status: 'automatic_confirmed',
      determination: 'automatic',
      provenance: { sourceType: context.planningArea.source }
    }] : [],
    affects: buildAffects(context),
    normativeReferences: {
      planningInstrument: context.planningInstrument?.value
    }
  }
}
