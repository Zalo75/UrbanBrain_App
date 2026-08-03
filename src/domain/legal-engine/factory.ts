import type {
  EvaluatedUrbanisticSituation,
  EvaluationJurisdiction,
  ProposedAction,
  TerritorialScope
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
