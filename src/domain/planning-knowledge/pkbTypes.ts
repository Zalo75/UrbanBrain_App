/** @deprecated Use NormativeDisposition instead */
export type PlanningKnowledgeEntryType =
  | 'ordinance'
  | 'zone'
  | 'grade'
  | 'subzone'
  | 'management_area'
  | 'execution_unit'
  | 'sector'
  | 'special_plan'
  | 'partial_plan'
  | 'catalogue_area'
  | 'other'

/** @deprecated Use Assessment / Validity instead */
export type PlanningKnowledgeStatus = 'draft' | 'reviewed' | 'published' | 'archived' | 'deprecated'

/** @deprecated Use PlanningKnowledgeGraph instead */
export interface PlanningKnowledgeBase {
  municipalityCode: string
  municipalityName: string
  version: string
  status: PlanningKnowledgeStatus
  instruments: PlanningKnowledgeInstrument[]
}

/** @deprecated Use PlanningInstrument instead */
export interface PlanningKnowledgeInstrument {
  instrumentId: string
  name: string
  kind: string
  approvalDate?: string
  effectiveFrom?: string
  effectiveTo?: string
  isBaseInstrument: boolean
  status: PlanningKnowledgeStatus
  entries: PlanningKnowledgeEntry[]
}

/** @deprecated Use NormativeDisposition instead */
export interface PlanningKnowledgeEntry {
  id: string
  type: PlanningKnowledgeEntryType
  code: string
  name: string

  parentId?: string

  compatibleLandClasses?: string[]
  compatibleCategories?: string[]

  binding: PlanningKnowledgeBinding

  status: PlanningKnowledgeStatus

  sourceEvidence?: PlanningKnowledgeEvidence[]
}

export interface PlanningKnowledgeBinding {
  documentNames: string[]
  articlesOrSections?: string[]
  pageRanges?: Array<{
    documentName: string
    fromPage?: number
    toPage?: number
  }>
}

export interface PlanningKnowledgeEvidence {
  documentName: string
  locator?: string
  text?: string
  reviewedBy?: string
  reviewedAt?: string
}

export interface PlanningKnowledgeValidationError {
  code: string
  path: string
  message: string
}

export interface PlanningKnowledgeOptionsQuery {
  municipalityCode: string
  instrumentId?: string
  version?: string
  atDate?: string
  landClass?: string
  category?: string
  entryType?: PlanningKnowledgeEntryType
}

export type PlanningKnowledgeRegistrationResult =
  | { status: 'registered'; value: PlanningKnowledgeBase }
  | { status: 'duplicate'; existing: PlanningKnowledgeBase }
  | { status: 'invalid'; errors: PlanningKnowledgeValidationError[] }

export type PlanningKnowledgeLookupResult =
  | { status: 'found'; value: PlanningKnowledgeBase }
  | { status: 'not_found' }
  | { status: 'ambiguous'; candidates: PlanningKnowledgeBase[] }
  | { status: 'invalid'; errors: PlanningKnowledgeValidationError[] }

export type PlanningKnowledgeOptionsResult =
  | { status: 'found'; options: PlanningKnowledgeEntry[]; catalogue: PlanningKnowledgeBase }
  | { status: 'not_found'; reason: 'catalogue' | 'instrument' | 'version' | 'options' }
  | { status: 'ambiguous'; candidates: PlanningKnowledgeBase[] }
  | { status: 'invalid_query'; errors: PlanningKnowledgeValidationError[] }

import type { Validity, Assessment, Evidence, UrbanisticFactKind, UrbanisticFactValue } from '@/domain/legal-engine/types'

export type LegalNodeKind = 'instrument' | 'disposition'

export interface LegalNodeReference {
  kind: LegalNodeKind
  id: string
}

export type LegalRelationshipType =
  | 'MODIFIES'
  | 'REPLACES'
  | 'REPEALS'
  | 'PARTIALLY_REPEALS'
  | 'DEVELOPS'
  | 'COMPLEMENTS'
  | 'SUSPENDS'
  | 'RESTORES'
  | 'REFERS_TO'

export interface LegalRelationship {
  id: string
  source: LegalNodeReference
  target: LegalNodeReference
  type: LegalRelationshipType
  validity?: Validity
  assessment?: Assessment
  evidenceIds?: string[]
}

export type FactComparisonOperator =
  | 'EQUALS'
  | 'NOT_EQUALS'
  | 'IN'
  | 'NOT_IN'
  | 'EXISTS'
  | 'NOT_EXISTS'

export interface FactCondition {
  id: string
  factKind: UrbanisticFactKind
  operator: FactComparisonOperator
  expectedValue?: UrbanisticFactValue
  expectedValues?: UrbanisticFactValue[]
}

export interface NormativeDisposition {
  id: string
  instrumentId: string
  type: string
  code: string
  name: string
  parentDispositionId?: string
  applicabilityConditions?: FactCondition[]
  validity?: Validity
  assessment?: Assessment
  evidenceIds?: string[]
}

export interface PlanningInstrument {
  id: string
  name: string
  kind: string
  validity?: Validity
  assessment?: Assessment
  evidenceIds?: string[]
}

export type EvidenceSubjectKind = 'instrument' | 'disposition' | 'relationship'

export interface PlanningEvidenceLink {
  evidenceId: string
  subject: {
    kind: EvidenceSubjectKind
    id: string
  }
}

export interface PlanningKnowledgeGraph {
  municipalityCode: string
  municipalityName: string
  version: string
  instruments: PlanningInstrument[]
  dispositions: NormativeDisposition[]
  relationships: LegalRelationship[]
  evidences?: Evidence[]
  evidenceLinks?: PlanningEvidenceLink[]
}
