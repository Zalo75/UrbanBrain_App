import type { 
  EvaluatedUrbanisticSituation, 
  Assessment, 
  UrbanisticFact,
  UrbanisticFactKind 
} from '@/domain/legal-engine/types'

export type ApplicabilityStatus = 'CANDIDATE' | 'EXCLUDED' | 'INDETERMINATE' | 'REVIEW_REQUIRED'

export type ApplicabilityReasonCode =
  | 'CONDITIONS_MET'
  | 'FACT_MISMATCH'
  | 'MISSING_REQUIRED_FACT'
  | 'CONFLICTING_FACTS'
  | 'NO_APPLICABILITY_CONDITIONS'
  | 'GRAPH_NOT_FOUND'
  | 'INVALID_GRAPH_QUERY'

export interface ApplicabilityDecision {
  dispositionId: string
  status: ApplicabilityStatus
  matchedFactIds: string[]
  missingFactKinds: UrbanisticFactKind[]
  reasonCodes: ApplicabilityReasonCode[]
  assessment?: Assessment
  evidenceIds: string[]
}

export type ApplicabilityEvaluationResult =
  | {
      status: 'evaluated'
      situationId: string
      municipalityCode: string
      graphVersion: string
      decisions: ApplicabilityDecision[]
    }
  | {
      status: 'graph_not_found'
      situationId: string
      municipalityCode: string
      graphVersion: string
      reasonCode: 'GRAPH_NOT_FOUND'
    }
  | {
      status: 'invalid_request'
      situationId?: string
      reasonCode: 'INVALID_GRAPH_QUERY'
    }

export interface ApplicabilityEvaluationRequest {
  situation: EvaluatedUrbanisticSituation
  facts: UrbanisticFact[]
  graphIdentity: {
    municipalityCode: string
    version: string
  }
}

export interface ApplicabilityEngineV2 {
  evaluate(request: ApplicabilityEvaluationRequest): Promise<ApplicabilityEvaluationResult>
}
