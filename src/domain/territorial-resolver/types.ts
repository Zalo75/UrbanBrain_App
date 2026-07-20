export interface TerritorialCoordinates {
  lat: number
  lng: number
}

export interface ParcelGeometry {
  type: 'MultiPolygon'
  coordinates: number[][][][]
  crs: 'EPSG:4326'
}

export type TerritorialConfidence = 'high' | 'medium' | 'low'
export type TerritorialVerification = 'confirmed' | 'probable' | 'ambiguous' | 'unresolved'
export type OfficialSource = 'catastro' | 'cartociudad' | 'siotuga' | 'ideg'
export type OfficialSourceCheckStatus =
  | 'available'
  | 'partial'
  | 'timeout'
  | 'unavailable'
  | 'malformed'
  | 'not_found'
  | 'ambiguous'
  | 'conflict'

export interface OfficialSourceCheck {
  source: OfficialSource
  status: OfficialSourceCheckStatus
  checkedAt: string
  message: string
}

export interface ManualTerritorialContext {
  cadastralReference?: string
  municipality?: string
  address?: string
  coordinates?: TerritorialCoordinates
  classification?: string
  category?: string
  area?: string
  ordinance?: string
  observations?: string
  provenance: 'manual'
  verification: 'unverified' | 'technician_validated'
  recordedAt: string
  validatedAt?: string
  validatedBy?: string
}

export interface TerritorialEvidence {
  source: 'catastro' | 'cartociudad' | 'siotuga' | 'ideg' | 'urbanbrain'
  sourceUrl: string
  retrievedAt: string
  method: string
}

export interface TerritorialConflict {
  field: 'cadastralReference' | 'coordinates' | 'address' | 'municipality'
  authoritativeValue: string
  conflictingValue: string
  reason: string
}

export interface TerritorialWarning {
  code: string
  message: string
}

export interface TerritorialLocationCandidate {
  cadastralReference?: string
  normalizedAddress?: string
  municipality?: string
  municipalityCode?: string
  province?: string
  provinceCode?: string
  coordinates?: TerritorialCoordinates
  sourceId?: string
  type?: string
  evidence: TerritorialEvidence[]
}

export interface PlanningClassification {
  code: string
  categoryCode?: string
  label: string
  categoryLabel?: string
  sourceFeatureIds: string[]
}

export interface PlanningArea {
  type: 'nucleus' | 'sector' | 'unit' | 'zone'
  name: string
  sourceFeatureIds: string[]
}

export interface PlanningInstrumentReference {
  id: string
  name: string
  kind: string
  status: 'current' | 'historical' | 'catalogued_pending_spatial_validation'
  approvalDate?: string
  consolidatedTextDate?: string
  normativePublicationDate?: string
  sourceUrl: string
}

export interface PlanningDocumentReference {
  id: string
  instrumentId?: string
  title: string
  sourceUrl: string
  binding: 'general' | 'area_specific' | 'unverified_for_detected_area'
}

export interface PlanningApplicability {
  status: 'determined' | 'partial' | 'conflict' | 'not_determined'
  instrument?: string
  approvalDate?: string
  sourceUrl?: string
  classification?: PlanningClassification
  areas?: PlanningArea[]
  applicableInstruments?: PlanningInstrumentReference[]
  cataloguedInstruments?: PlanningInstrumentReference[]
  documents?: PlanningDocumentReference[]
  canAnswerConcreteParameters?: boolean
  conflicts?: string[]
  evidence: TerritorialEvidence[]
  warnings: TerritorialWarning[]
  sourceChecks?: OfficialSourceCheck[]
}

export interface TerritorialAffect {
  category: string
  name: string
  featureId?: string
  attributes: Record<string, unknown>
  evidence: TerritorialEvidence
  confidence: TerritorialConfidence
}

export interface AffectApplicability {
  analysisGeometry: 'parcel' | 'point' | 'none'
  detected: TerritorialAffect[]
  canRuleOutUndetectedAffects: false
  warnings: TerritorialWarning[]
  sourceChecks?: OfficialSourceCheck[]
}

export interface TerritorialContinuity {
  lastOfficialContext?: TerritorialResolution
  effectiveOfficialContext?: TerritorialResolution
  usingPreviousOfficialContext: boolean
  sameParcelAsPrevious: boolean
  manualContext?: ManualTerritorialContext
}

export interface TerritorialResolution {
  status: TerritorialVerification
  confidence: TerritorialConfidence
  inputMethod: 'cadastral_reference' | 'coordinates' | 'address' | 'none'
  cadastralReference?: string
  parcelReference?: string
  normalizedAddress?: string
  municipality?: string
  municipalityCode?: string
  province?: string
  provinceCode?: string
  coordinates?: TerritorialCoordinates
  parcelGeometry?: ParcelGeometry
  candidates: TerritorialLocationCandidate[]
  evidence: TerritorialEvidence[]
  warnings: TerritorialWarning[]
  conflicts: TerritorialConflict[]
  sourceChecks?: OfficialSourceCheck[]
  continuity?: TerritorialContinuity
  planning: PlanningApplicability
  affects: AffectApplicability
  resolvedAt: string
  attemptStartedAt?: string
}

export interface ResolveParcelLocationInput {
  cadastralReference?: string | null
  coordinates?: TerritorialCoordinates | null
  address?: string | null
  declaredMunicipality?: string | null
}

export interface CatastroParcel {
  cadastralReference: string
  normalizedAddress?: string
  municipality?: string
  municipalityCode?: string
  province?: string
  provinceCode?: string
  coordinates?: TerritorialCoordinates
  geometry?: ParcelGeometry
  evidence: TerritorialEvidence[]
  sourceChecks?: OfficialSourceCheck[]
}

export interface CatastroPort {
  resolveReference(reference: string): Promise<CatastroParcel | null>
  resolveCoordinates(coordinates: TerritorialCoordinates): Promise<string | null>
}

export interface GeocoderPort {
  geocode(address: string): Promise<TerritorialLocationCandidate[]>
  reverse(coordinates: TerritorialCoordinates): Promise<TerritorialLocationCandidate | null>
}

export interface PlanningPort {
  findApplicablePlanning(location: {
    municipalityCode?: string
    coordinates?: TerritorialCoordinates
    geometry?: ParcelGeometry
  }): Promise<PlanningApplicability>
}

export interface AffectPort {
  findAffects(location: {
    coordinates?: TerritorialCoordinates
    geometry?: ParcelGeometry
  }): Promise<AffectApplicability>
}
