import type {
  UrbanisticFactStatus,
  OfficialSource,
  TerritorialConfidence,
} from '@/domain/territorial-resolver/types'
import type { ParcelContextSource } from '@/domain/parcel-context/types'

export type FactDeterminationType = 'automatic' | 'manual' | 'effective' | 'unresolved'

export type SemanticCompleteness = 'complete' | 'partial'

export interface FactualProvenance {
  sourceName?: string
  sourceType?: OfficialSource | ParcelContextSource | string
  evidence?: string
  resolvedAt?: string
  confidence?: TerritorialConfidence | 'unknown' | number
  documentType?: string
  applicability?: string
}

export interface FactualCandidate {
  code: string
  label?: string
  semanticCompleteness?: SemanticCompleteness
  parcelPercentage?: number
  intersectionAreaSquareMetres?: number
}

export interface FactualClassification {
  code?: string
  label?: string
  semanticCompleteness?: SemanticCompleteness
  status: UrbanisticFactStatus | 'unresolved'
  determination: FactDeterminationType
  provenance?: FactualProvenance
  candidates?: FactualCandidate[]
}

export interface FactualCategory {
  code?: string
  label?: string
  semanticCompleteness?: SemanticCompleteness
  status: UrbanisticFactStatus | 'unresolved'
  determination: FactDeterminationType
  parcelPercentage?: number
  intersectionAreaSquareMetres?: number
  provenance?: FactualProvenance
  candidates?: FactualCandidate[]
}

export interface FactualConsolidation {
  code?: string
  label?: string
  semanticCompleteness?: SemanticCompleteness
  status: UrbanisticFactStatus | 'unresolved'
  determination: FactDeterminationType
  provenance?: FactualProvenance
}

export interface FactualPlanningArea {
  code?: string
  label?: string
  semanticCompleteness?: SemanticCompleteness
  status: UrbanisticFactStatus | 'unresolved'
  determination: FactDeterminationType
  provenance?: FactualProvenance
}

export interface FactualAffect {
  code?: string
  label: string
  status: UrbanisticFactStatus | 'unresolved'
  determination: FactDeterminationType
  provenance?: FactualProvenance
  intersectionAreaSquareMetres?: number
}

export interface FactualAffectsState {
  status: 'unresolved' | 'checked' | 'conflict'
  items: FactualAffect[]
}

export interface FactualScope {
  areaSquareMetres?: number
  hasGeometry: boolean
  source?: string
}

export interface FactualScopeFacts {
  classification?: FactualClassification
  categories?: FactualCategory[]
  consolidation?: FactualConsolidation
  planningAreas?: FactualPlanningArea[]
  affects?: FactualAffectsState
}

export interface TerritorialFactualContract {
  identity: {
    municipalityName?: string
    municipalityCode?: string
    cadastralReference?: string
    address?: string
    coordinates?: { lat: number; lng: number }
  }
  scopes: {
    parcel?: FactualScope
    actionArea?: FactualScope
  }
  /** Canonical scoped facts; optional only for legacy contracts created before L2.6 Block 2.2A. */
  factsByScope?: {
    parcel?: FactualScopeFacts
    actionArea?: FactualScopeFacts
  }
  // Legacy compatibility fields; factsByScope is canonical for scoped resolution.
  classification: FactualClassification
  categories: FactualCategory[]
  consolidation: FactualConsolidation
  planningAreas: FactualPlanningArea[]
  affects: FactualAffectsState
  
  normativeReferences: {
    planningInstrument?: string
  }
}
