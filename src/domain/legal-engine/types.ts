export interface EvaluationJurisdiction {
  municipalityCode: string
  provinceCode?: string
}

export interface ProposedAction {
  type: string
  description?: string
}

export interface TerritorialScope {
  id: string
  type: 'parcel' | 'building' | 'geometry' | 'custom'
  cadastralReference?: string
  description?: string
}

export interface EvaluatedUrbanisticSituation {
  id: string
  expedienteId?: string
  referenceDate: string // ISO 8601
  jurisdiction: EvaluationJurisdiction
  action?: ProposedAction
  territorialScope: TerritorialScope
}

export type UrbanisticFactKind = 'classification' | 'category' | 'consolidation' | 'affect' | 'parameter'

export type UrbanisticFactValue = string | number | boolean

export interface UrbanisticFact {
  id: string
  situationId: string
  property: UrbanisticFactKind
  value: UrbanisticFactValue
  createdAt: string
}

export type EvidenceKind = 'document' | 'geometry' | 'official_registry' | 'manual_inspection'

export interface Evidence {
  id: string
  subjectId: string
  kind: EvidenceKind
  sourceReference?: string
  sourceLocation?: string
  description?: string
  createdAt: string
}

export type ValidityStatus = 'ACTIVE' | 'FUTURE' | 'EXPIRED' | 'SUSPENDED'

export interface Validity {
  status: ValidityStatus
  validFrom?: string
  validUntil?: string
}

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN'

export type VerificationStatus = 'VERIFIED' | 'UNVERIFIED' | 'CONTESTED' | 'INFERRED'

export interface Assessment {
  confidence: ConfidenceLevel
  verification: VerificationStatus
  warnings: string[]
  discrepancies: string[]
}
