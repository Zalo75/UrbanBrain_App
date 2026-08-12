export type StructuredFactRef =
  | { type: 'classification' }
  | { type: 'category'; code: string }
  | { type: 'category_candidate'; categoryCode: string; candidateCode: string }
  | { type: 'consolidation' }
  | { type: 'planning_area'; code: string }
  | { type: 'affect'; label: string }
  | { type: 'affects_state' }
  | { type: 'scope'; scopeType: 'parcel' | 'actionArea' }

export type StructuredOperation =
  | { operation: 'reference_code'; factRef: StructuredFactRef; code: string }
  | { operation: 'state_label'; factRef: StructuredFactRef; label: string }
  | { operation: 'state_percentage'; factRef: StructuredFactRef; percentage: number }
  | { operation: 'state_status'; factRef: StructuredFactRef; status: string }
  | { operation: 'state_determination'; factRef: StructuredFactRef; determination: string }
  | { operation: 'state_geometric_dominance'; factRef: StructuredFactRef }
  | { operation: 'state_conflict'; factRef: StructuredFactRef }
  | { operation: 'state_unresolved'; factRef: StructuredFactRef }
  | { operation: 'state_absence'; factRef: StructuredFactRef }

export type StructuredAbstentionCause =
  | 'missing_label'
  | 'unresolved_fact'
  | 'conflict'
  | 'missing_fact'
  | 'scope_mismatch'
  | 'unsupported_operation'

export interface StructuredAbstention {
  cause: StructuredAbstentionCause
  factRef?: StructuredFactRef
  context?: string
}

export interface StructuredFactualOutput {
  operations: StructuredOperation[]
  abstentions: StructuredAbstention[]
}
