import type { ApplicabilityEvaluationResult } from './applicability'
import type { PlanningKnowledgeGraph } from '../planning-knowledge/pkbTypes'

export type PrecedenceStatus = 'EFFECTIVE' | 'DISPLACED' | 'SUSPENDED' | 'INDETERMINATE' | 'REVIEW_REQUIRED'

export type PrecedenceReasonCode =
  | 'NO_PRECEDENCE_EFFECT'
  | 'DISPLACED_BY_REPEAL'
  | 'DISPLACED_BY_REPLACEMENT'
  | 'SUSPENDED_BY_RELATIONSHIP'
  | 'MODIFICATION_SCOPE_UNKNOWN'
  | 'PARTIAL_REPEAL_SCOPE_UNKNOWN'
  | 'RESTORATION_CHAIN_UNRESOLVED'
  | 'CYCLIC_RELATIONSHIP'
  | 'CONTRADICTORY_RELATIONSHIPS'

export interface PrecedenceDecision {
  dispositionId: string
  status: PrecedenceStatus
  reasonCodes: PrecedenceReasonCode[]
  appliedRelationshipIds: string[]
}

export interface PrecedenceEvaluationRequest {
  applicabilityResult: ApplicabilityEvaluationResult
  graph: PlanningKnowledgeGraph
}

export type PrecedenceEvaluationResult =
  | {
      status: 'evaluated'
      situationId: string
      municipalityCode: string
      graphVersion: string
      decisions: PrecedenceDecision[]
    }
  | {
      status: 'invalid_request'
      situationId?: string
      reasonCode: 'INVALID_PRECEDENCE_REQUEST'
    }

export interface PrecedenceEngineV2 {
  evaluate(request: PrecedenceEvaluationRequest): PrecedenceEvaluationResult
}
