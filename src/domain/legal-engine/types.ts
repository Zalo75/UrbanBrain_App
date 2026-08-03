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
