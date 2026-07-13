export type ParcelContextSource =
  | 'expediente'
  | 'catastro'
  | 'cartociudad'
  | 'siotuga'
  | 'ideg'
  | 'urbanbrain'
  | 'conversation'
  | 'territory_catalogue'

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
  cadastralReference?: ParcelContextField<string>
  address?: ParcelContextField<string>
  coordinates?: ParcelContextField<ParcelCoordinates>
  municipality?: ParcelContextField<{ id?: string; name: string; ineCode?: string }>
  province?: ParcelContextField<{ id?: string; name: string }>
  landClass?: ParcelContextField<string>
  qualification?: ParcelContextField<string>
  planningArea?: ParcelContextField<string>
  planningInstrument?: ParcelContextField<string>
  validity?: ParcelContextField<string>
  knownConstraints: Array<ParcelContextField<string>>
  conflicts: ParcelConflict[]
  pendingValidation: string[]
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

export interface NormativeCandidate {
  id: string
  content: string
  municipalityName?: string | null
  documentName?: string | null
  title?: string | null
  page?: string | number | null
  sourceUrl?: string | null
  similarity?: number | null
  hierarchy?: NormativeHierarchyLevel
  status?: string | null
  ordinance?: string | null
  landClass?: string | null
  planningArea?: string | null
  parentInstrument?: string | null
}

export interface ApplicabilityResult {
  status: ApplicabilityStatus
  applicable: NormativeCandidate[]
  rejected: Array<{ candidate: NormativeCandidate; reason: string }>
  warnings: string[]
  missingData: string[]
  conflicts: string[]
  canAnswerConcreteParameters: boolean
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
