import type { StructuredFactScope } from './structuredFactualOutput'

export type FactualComposerIntent =
  | 'strict_homogeneity'
  | 'category_distribution'
  | 'category_identity'
  | 'classification_identity'
  | 'state_explanation'

export type FactualComposerRequestedFactType =
  | 'classification'
  | 'category'
  | 'percentage'
  | 'status'
  | 'determination'
  | 'geometricDominance'

export interface FactualComposerFact {
  id: string
  type: 'classification' | 'category'
  scope: StructuredFactScope
  code?: string
  label?: string
  percentage?: number
  status?: string
  determination?: string
  geometricDominance: boolean
}

export interface FactualComposerEvidence {
  schemaVersion: '1'
  questionIntent: FactualComposerIntent
  scope: StructuredFactScope
  requestedFactTypes: FactualComposerRequestedFactType[]
  validatedFacts: FactualComposerFact[]
}

export type FactualComposerConclusionKind =
  | 'not_strictly_homogeneous'
  | 'strictly_homogeneous'
  | 'category_distribution'
  | 'category_identity'
  | 'classification_identity'
  | 'state_summary'

export interface FactualComposerConclusion {
  kind: FactualComposerConclusionKind
  targetFactId?: string
}

export type FactualComposerExplanation =
  | { kind: 'fact_identity'; factId: string }
  | { kind: 'category_share'; factId: string }
  | { kind: 'geometric_dominance'; factId: string }

export type FactualComposerCaveat =
  | { kind: 'conflict'; factId: string }
  | { kind: 'unresolved'; factId: string }
  | { kind: 'manual_review_required'; factId: string }
  | { kind: 'manual_determination'; factId: string }
  | { kind: 'automatic_status'; factId: string }
  | { kind: 'automatic_determination'; factId: string }

export type FactualComposerRecommendedCheck =
  | 'verify_minority_area'
  | 'confirm_pending_determination'

export interface FactualComposerPlan {
  schemaVersion: '1'
  conclusion: FactualComposerConclusion
  explanation: FactualComposerExplanation[]
  caveats: FactualComposerCaveat[]
  recommendedChecks: FactualComposerRecommendedCheck[]
}

export type FactualComposerSchemaErrorCode =
  | 'missing_required_field'
  | 'additional_property'
  | 'invalid_type'
  | 'invalid_enum'
  | 'invalid_literal'

export interface FactualComposerSchemaError {
  code: FactualComposerSchemaErrorCode
  path: string
  valueType?: 'array' | 'boolean' | 'null' | 'number' | 'object' | 'string' | 'undefined'
  invalidEnum?: string
}

export type FactualComposerSafetyErrorCode =
  | 'wrong_scope'
  | 'unknown_fact_ref'
  | 'duplicate_plan_item'
  | 'wrong_conclusion'
  | 'missing_target'
  | 'categorical_totality'
  | 'missing_material_category'
  | 'missing_material_fact'
  | 'unsupported_percentage'
  | 'dominance_mismatch'
  | 'missing_dominance'
  | 'missing_conflict'
  | 'missing_unresolved'
  | 'missing_manual_state'
  | 'missing_automatic_state'
  | 'unsupported_caveat'
  | 'unsupported_check'

export type FactualComposerFallbackReason =
  | 'unsupported_intent'
  | 'evidence_invalid'
  | 'provider_error'
  | 'timeout'
  | 'invalid_json'
  | 'invalid_schema'
  | 'safety_rejected'
  | 'render_empty'

export interface FactualComposerDiagnostics {
  totalMs: number
  providerMs: number
  inputTokens?: number
  outputTokens?: number
  status: 'composed' | 'fallback'
  fallbackUsed: boolean
  fallbackReason: FactualComposerFallbackReason | null
  model: string
  schemaErrorCount?: number
  schemaErrorCodes?: FactualComposerSchemaErrorCode[]
  schemaErrorPaths?: string[]
  schemaErrorValueTypes?: string[]
  schemaInvalidEnums?: string[]
  safetyErrorCodes?: FactualComposerSafetyErrorCode[]
}

export interface FactualComposerResult {
  answer: string
  diagnostics: FactualComposerDiagnostics
}
