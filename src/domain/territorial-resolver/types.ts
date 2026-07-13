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

export interface PlanningApplicability {
  status: 'determined' | 'not_determined'
  instrument?: string
  approvalDate?: string
  sourceUrl?: string
  evidence: TerritorialEvidence[]
  warnings: TerritorialWarning[]
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
}

export interface TerritorialResolution {
  status: TerritorialVerification
  confidence: TerritorialConfidence
  inputMethod: 'cadastral_reference' | 'coordinates' | 'address' | 'none'
  cadastralReference?: string
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
  planning: PlanningApplicability
  affects: AffectApplicability
  resolvedAt: string
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
  findApplicablePlanning(municipalityCode: string | undefined): Promise<PlanningApplicability>
}

export interface AffectPort {
  findAffects(location: {
    coordinates?: TerritorialCoordinates
    geometry?: ParcelGeometry
  }): Promise<AffectApplicability>
}
