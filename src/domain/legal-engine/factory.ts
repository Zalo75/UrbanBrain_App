import type {
  EvaluatedUrbanisticSituation,
  EvaluationJurisdiction,
  ProposedAction,
  TerritorialScope,
  UrbanisticFact,
  UrbanisticFactKind,
  UrbanisticFactValue,
  Evidence,
  EvidenceKind,
  Validity,
  ValidityStatus
} from './types'

export interface CreateEvaluatedSituationParams {
  id: string
  referenceDate: string
  jurisdiction: EvaluationJurisdiction
  territorialScope: TerritorialScope
  expedienteId?: string
  action?: ProposedAction
}

export function createEvaluatedSituation(
  params: CreateEvaluatedSituationParams
): EvaluatedUrbanisticSituation {
  if (!params.id) {
    throw new Error('id is required')
  }
  if (!params.referenceDate) {
    throw new Error('referenceDate is required')
  }
  if (!params.jurisdiction || !params.jurisdiction.municipalityCode) {
    throw new Error('jurisdiction.municipalityCode is required')
  }
  if (!params.territorialScope || !params.territorialScope.id) {
    throw new Error('territorialScope.id is required')
  }

  return {
    id: params.id,
    referenceDate: params.referenceDate,
    jurisdiction: { ...params.jurisdiction },
    territorialScope: { ...params.territorialScope },
    ...(params.expedienteId ? { expedienteId: params.expedienteId } : {}),
    ...(params.action ? { action: { ...params.action } } : {})
  }
}

export interface CreateUrbanisticFactParams {
  id: string
  situationId: string
  property: UrbanisticFactKind
  value: UrbanisticFactValue
  createdAt: string
}

export function createUrbanisticFact(params: CreateUrbanisticFactParams): UrbanisticFact {
  if (!params.id) throw new Error('id is required')
  if (!params.situationId) throw new Error('situationId is required')
  if (!params.property) throw new Error('property is required')
  if (params.value === undefined || params.value === null) throw new Error('value is required')
  if (!params.createdAt) throw new Error('createdAt is required')

  return {
    id: params.id,
    situationId: params.situationId,
    property: params.property,
    value: params.value,
    createdAt: params.createdAt
  }
}

export interface CreateEvidenceParams {
  id: string
  subjectId: string
  kind: EvidenceKind
  sourceReference?: string
  sourceLocation?: string
  description?: string
  createdAt: string
}

export function createEvidence(params: CreateEvidenceParams): Evidence {
  if (!params.id) throw new Error('id is required')
  if (!params.subjectId) throw new Error('subjectId is required')
  if (!params.kind) throw new Error('kind is required')
  if (!params.createdAt) throw new Error('createdAt is required')

  return {
    id: params.id,
    subjectId: params.subjectId,
    kind: params.kind,
    ...(params.sourceReference ? { sourceReference: params.sourceReference } : {}),
    ...(params.sourceLocation ? { sourceLocation: params.sourceLocation } : {}),
    ...(params.description ? { description: params.description } : {}),
    createdAt: params.createdAt
  }
}

export interface CreateValidityParams {
  status: ValidityStatus
  validFrom?: string
  validUntil?: string
}

export function createValidity(params: CreateValidityParams): Validity {
  if (!params.status) throw new Error('status is required')

  return {
    status: params.status,
    ...(params.validFrom ? { validFrom: params.validFrom } : {}),
    ...(params.validUntil ? { validUntil: params.validUntil } : {})
  }
}
