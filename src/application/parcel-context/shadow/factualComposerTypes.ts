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
}

export interface FactualComposerResult {
  answer: string
  diagnostics: FactualComposerDiagnostics
}
