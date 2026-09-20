import type { ParcelAccounting } from '@/domain/territorial-resolver/parcelAccounting'
import type {
  ActionAreaSelection,
  ParcelGeometry,
  TerritorialEvidence,
  UrbanisticRegimeFacts,
  OrdinanceCandidate,
} from '@/domain/territorial-resolver/types'

export type ParcelContextSource =
  | 'expediente'
  | 'catastro'
  | 'cartociudad'
  | 'siotuga'
  | 'ideg'
  | 'urbanbrain'
  | 'conversation'
  | 'territory_catalogue'
  | 'manual'

export type ParcelContextVerification = 'confirmed' | 'unverified' | 'inferred'

export interface ParcelContextField<T> {
  value: T
  source: ParcelContextSource
  confidence: number
  verification: ParcelContextVerification
  evidence?: string
}

export interface ParcelCoordinates {
  lat: number
  lng: number
}

export interface ParcelConflict {
  field: string
  values: string[]
  reason: string
}

export interface NormalizedParcelContext {
  coverage?: ParcelAccounting
  cadastralReference?: ParcelContextField<string>
  address?: ParcelContextField<string>
  coordinates?: ParcelContextField<ParcelCoordinates>
  municipality?: ParcelContextField<{ id?: string; name: string; ineCode?: string }>
  province?: ParcelContextField<{ id?: string; name: string }>
  landClass?: ParcelContextField<string>
  qualification?: ParcelContextField<string>
  ordinanceCandidates?: OrdinanceCandidate[]
  planningArea?: ParcelContextField<string>
  planningInstrument?: ParcelContextField<string>
  validity?: ParcelContextField<string>
  technicalNotes?: ParcelContextField<string>
  canAnswerConcreteParameters?: boolean
  urbanisticFacts?: UrbanisticRegimeFacts
  parcelUrbanisticFacts?: UrbanisticRegimeFacts
  actionArea?: ParcelContextField<ActionAreaSelection>
  parcelGeometry?: ParcelGeometry
  parcelSurfaceSquareMetres?: number
  parcelKnownConstraints?: Array<ParcelContextField<string>>
  knownConstraints: Array<ParcelContextField<string>>
  conflicts: ParcelConflict[]
  pendingValidation: string[]
  reliability?: {
    mode:
      | 'current_official'
      | 'partial_official'
      | 'previous_official'
      | 'manual_unverified'
      | 'technician_validated_manual'
      | 'unresolved'
    latestAttemptAt?: string
    officialContextResolvedAt?: string
    usingPreviousOfficialContext?: boolean
    sourceIssues: string[]
  }
  regimeIdentity?: ParcelRegimeIdentity
}

export type ApplicabilityStatus =
  | 'DETERMINADO'
  | 'PARCIAL'
  | 'CONFLICTIVO'
  | 'NO_DETERMINADO'

export type NormativeHierarchyLevel =
  | 'estatal'
  | 'autonomico'
  | 'municipal'
  | 'desarrollo'
  | 'ordenanza'
  | 'ficha'
  | 'sectorial'

export interface NormativeRegimeIdentity {
  kind: 'ordinance' | 'planning_area' | 'land_class' | 'general' | 'equivalent'
  code?: string
  label?: string
  instrumentId?: string
  provenance: 'explicit_heading' | 'inherited_heading' | 'deterministic_inference' | 'ai_assisted' | 'manual'
  confidence: 'high' | 'medium' | 'low'
  ambiguity?: string[]
}

export type ParcelRegimeIdentityStatus =
  | 'effective'
  | 'automatic'
  | 'review'
  | 'conflict'
  | 'unresolved'

export type ParcelRegimeGeometryScope = 'whole_parcel' | 'action_area' | 'partial' | 'unknown'

export interface ParcelRegimeIdentityScope {
  scope: 'parcel' | 'action_area'
  classification?: { code?: string; label?: string }
  category?: {
    code?: string
    label?: string
    parcelPercentage?: number
    intersectionAreaSquareMetres?: number
  }
  qualification?: string
  ordinances?: OrdinanceCandidate[]
  planningArea?: string
  instrumentId?: string
  status: ParcelRegimeIdentityStatus
  confidence: number | 'unknown'
  geometryScope: ParcelRegimeGeometryScope
  provenance: string[]
  evidence: TerritorialEvidence[]
  conflicts: string[]
  automaticCandidates?: Array<{
    code?: string
    label?: string
    parcelPercentage?: number
    intersectionAreaSquareMetres?: number
  }>
}

/** Derived, in-memory projection used to compare parcel facts with normative metadata. */
export interface ParcelRegimeIdentity {
  scopes: ParcelRegimeIdentityScope[]
  status: ParcelRegimeIdentityStatus
  confidence: number | 'unknown'
  provenance: string[]
  evidence: TerritorialEvidence[]
  conflicts: string[]
}

export interface NormativeCandidate {
  id: string
  /** Stable evidence identifiers accepted by the accredited-reality branch. */
  sourceAliases?: string[]
  content: string
  municipalityName?: string | null
  documentName?: string | null
  title?: string | null
  page?: string | number | null
  sourceUrl?: string | null
  similarity?: number | null
  hierarchy?: NormativeHierarchyLevel
  status?: string | null
  regimeMetadata?: NormativeRegimeIdentity | null
  ordinance?: string | null
  landClass?: string | null
  planningArea?: string | null
  parentInstrument?: string | null
  /** Whether retrieval was filtered to the canonical ordinance or only to its documents. */
  evidenceSpecificity?: 'SPECIFIC' | 'NON_SPECIFIC'
  identityId?: string | null
  normativeReferences?: Array<{ documentId: string; chunkIds: string[]; article?: string; relation: 'defines' | 'regulates' | 'mentions'; sourceId: string }>
  catalogStatus?: 'ACCEPTED' | 'REVIEW_REQUIRED' | 'REJECTED' | null
  trustLevel?: 'OFFICIAL_SCOPED_PROVISIONAL' | string | null
}

export interface ApplicabilityResult {
  status: ApplicabilityStatus
  applicable: NormativeCandidate[]
  review: NormativeCandidate[]
  rejected: Array<{ candidate: NormativeCandidate; reason: string }>
  warnings: string[]
  missingData: string[]
  conflicts: string[]
  canAnswerConcreteParameters: boolean
  canAnswerGeneralRegime?: boolean
  canAnswerConditionalViability?: boolean
}

export interface SafeAnswerContract {
  conclusion: string
  confidence: number
  parcelContext: NormalizedParcelContext
  applicability: ApplicabilityStatus
  hierarchy: Partial<Record<NormativeHierarchyLevel, string[]>>
  citations: number[]
  warnings: string[]
  decision: 'answer' | 'abstain'
}

export interface ReasonerClaim {
  id: string
  type: 'territorial_fact' | 'normative_fact' | 'normative_conditional' | 'parcel_conclusion' | 'limitation'
  text: string
  sourceRefs: number[]
  appliesToParcel: boolean | 'conditional' | 'unknown'
  numericTokens: string[]
}

export interface ReasonerOutput {
  answerMode: 'definitive' | 'conditional' | 'partial' | 'abstain'
  claims: ReasonerClaim[]
  missingFacts: string[]
}
