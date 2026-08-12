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
  classification: FactualClassification
  categories: FactualCategory[]
  consolidation: FactualConsolidation
  planningAreas: FactualPlanningArea[]
  affects: FactualAffectsState
  
  normativeReferences: {
    planningInstrument?: string
  }
}
