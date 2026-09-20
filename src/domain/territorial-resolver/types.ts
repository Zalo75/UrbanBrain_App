export interface TerritorialCoordinates {
  lat: number
  lng: number
}

import type { ParcelContextSource } from '@/domain/parcel-context/types'
import type { PlanningNormativeDocumentType } from '@/domain/planning-knowledge/types'

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

export type UrbanisticFactId =
  | 'classification'
  | 'category'
  | 'consolidation'

export type ManualFactOrigin =
  | 'technician_selection'
  | 'technician_confirmation'

export type ConsolidationCode =
  | 'consolidated'
  | 'unconsolidated'
  | 'not_applicable'

export interface UrbanisticFactValue {
  code: string
  label?: string
}

export interface ConsolidationFactValue extends UrbanisticFactValue {
  code: ConsolidationCode
}

export interface ManualUrbanisticFactState<
  T extends UrbanisticFactValue = UrbanisticFactValue
> {
  origin: ManualFactOrigin
  value: T
  reason: string
  recordedAt: string
  recordedBy: string
  verification: 'unverified' | 'technician_validated'
  validatedAt?: string
  validatedBy?: string
}

export type DeterminationOrigin = 'automatic' | 'technician_selection'
export type DeterminationVerification = 'unverified' | 'technician_validated'

export interface ContextDetermination<T> {
  value: T
  origin: DeterminationOrigin
  source: ParcelContextSource
  verification: DeterminationVerification
  determinedAt?: string
  recordedAt?: string
  recordedBy?: string
  validatedAt?: string
  validatedBy?: string
  previousAutomaticValue?: T
}

export interface ContextDeterminationState<T> {
  automatic?: ContextDetermination<T>
  technician?: ContextDetermination<T>
  candidates?: OrdinanceCandidate[]
  status?: string
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
  affectDecisions?: ManualAffectDecision[]
  urbanisticFacts?: {
    classification?: ManualUrbanisticFactState
    category?: ManualUrbanisticFactState
    consolidation?: ManualUrbanisticFactState<ConsolidationFactValue>
  }
  classificationDetermination?: { technician?: ContextDetermination<string> }
  categoryDetermination?: { technician?: ContextDetermination<string> }
  ordinanceDetermination?: { technician?: ContextDetermination<string> }
  provenance: 'manual'
  verification: 'unverified' | 'technician_validated'
  recordedAt: string
  validatedAt?: string
  validatedBy?: string
  actionAreaSelection?: ActionAreaSelectionState
}

export type ManualAffectDecisionAction = 'add' | 'confirm' | 'exclude'

export interface ManualAffectDecision {
  id: string
  targetKey?: string
  category: string
  name: string
  action: ManualAffectDecisionAction
  reason: string
  provenance: 'manual'
  verification: 'unverified' | 'technician_validated'
  recordedAt: string
  recordedBy: string
  validatedAt?: string
  validatedBy?: string
}

export interface TerritorialEvidence {
  source: 'catastro' | 'cartociudad' | 'siotuga' | 'ideg' | 'urbanbrain'
  sourceUrl: string
  retrievedAt: string
  method: string
  scope?: 'location' | 'planning_instrument' | 'planning_classification' | 'affect'
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

export type ClassificationResolutionStatus =
  | 'clear'
  | 'probable'
  | 'multiple_intersections'
  | 'review_required'
  | 'not_available'
  | 'source_unavailable'

export type ClassificationNextAction =
  | 'auto_accept'
  | 'manual_selection'
  | 'review_official_sources'
  | 'retry_source'

export type ClassificationReviewReason =
  | 'point_geometry_mismatch'
  | 'partial_parcel_coverage'
  | 'planning_update_scope_pending'
  | 'instrument_traceability_pending'
  | 'instrument_layer_mismatch'
  | 'source_disagreement'
  | 'intra_source_disagreement'
  | 'incomplete_source_check'
  | 'ambiguous_code_mapping'
  | 'insufficient_geometry'

export type ClassificationEvidenceBasis =
  | 'parcel_geometry'
  | 'representative_point'
  | 'official_document'
  | 'implicit_planning_background'

export type ClassificationInstrumentTraceability = 'verified' | 'pending' | 'mismatch'

export type ClassificationConfidenceLevel = 'confirmed' | 'probable' | 'unknown'

export interface ClassificationParcelCoverage {
  parcelAreaSquareMetres: number
  intersectionAreaSquareMetres: number
  parcelPercentage: number
  method: 'polygon_intersection'
  intersectionGeometry?: ParcelGeometry
}

export interface OfficialClassificationAttributes {
  sourceFeatureId: string
  enclosureId?: string
  classificationCode: string
  categoryCode?: string
  legalClassificationCode?: string
  legalCategoryCode?: string
  planningCategoryCode?: string
  denomination?: string
  use?: string
  geometryAreaSquareMetres?: number
  status?: string
  version?: string
}

export interface OfficialClassificationCandidate {
  kind: 'official_classification'
  id: string
  sourceKey?: string
  classification: PlanningClassification
  areas: PlanningArea[]
  source: Exclude<TerritorialEvidence['source'], 'urbanbrain'>
  evidence: TerritorialEvidence[]
  confidence: TerritorialConfidence
  evidenceBasis: ClassificationEvidenceBasis
  instrumentTraceability: ClassificationInstrumentTraceability
  normalizationStatus: 'mapped' | 'unmapped'
  parcelCoverage?: ClassificationParcelCoverage
  officialAttributes?: OfficialClassificationAttributes[]
}

export interface DerivedUnmappedComplementCandidate {
  kind: 'derived_unmapped_complement'
  id: string
  sourceKey?: string
  classification?: undefined
  category?: undefined
  planningZone?: undefined
  source: 'derived_geometry_complement'
  evidence: TerritorialEvidence[]
  confidence: 'unknown'
  evidenceBasis: 'parcel_geometry'
  instrumentTraceability: 'pending'
  normalizationStatus: 'unmapped'
  parcelCoverage: ClassificationParcelCoverage
  areas: PlanningArea[]
}

export type ClassificationCandidate = OfficialClassificationCandidate | DerivedUnmappedComplementCandidate

export interface ClassificationDiscrepancyAssertion {
  candidateId?: string
  value: string
  source: TerritorialEvidence['source']
  evidence: TerritorialEvidence[]
}

export interface ClassificationDiscrepancy {
  reason: ClassificationReviewReason
  field: 'classification' | 'category' | 'area' | 'instrument' | 'coverage'
  explanation: string
  assertions: ClassificationDiscrepancyAssertion[]
}

export interface ClassificationProposal {
  candidateId: string
  explanation: string
  confidence: TerritorialConfidence
  requiresProfessionalReview: boolean
}

export interface ClassificationSelection {
  origin: 'automatic' | 'urbanbrain_proposal' | 'manual'
  candidateId?: string
  classificationCode?: string
  categoryCode?: string
  operationalValue?: string
  areaNames: string[]
  reason?: string
  primarySource?: string
  corroboratingSources?: string[]
  confidence?: TerritorialConfidence
  selectedAt?: string
  selectedBy?: string
  technicianValidated: boolean
  resolutionFingerprint?: string
}

export interface ClassificationSourceResult {
  candidates: ClassificationCandidate[]
  discrepancies: ClassificationDiscrepancy[]
  sourceChecks: ClassificationSourceCheck[]
  officialLinks: OfficialResourceLink[]
  evidence: TerritorialEvidence[]
  warnings: TerritorialWarning[]
  resources?: TerritorialResourceCatalog
}

export interface ClassificationSourcePort {
  findClassifications(
    planning: PlanningApplicability,
    location: {
      municipalityCode?: string
      coordinates?: TerritorialCoordinates
      geometry?: ParcelGeometry
    }
  ): Promise<ClassificationSourceResult>
}

export interface OfficialResourceLink {
  kind:
    | 'catastro_viewer'
    | 'siotuga_viewer'
    | 'municipal_viewer'
    | 'planning_document'
    | 'official_map'
  label: string
  url: string
  source: OfficialSource | 'municipal'
  scope: 'parcel' | 'municipality' | 'instrument' | 'layer'
}

export interface ClassificationSourceCheck extends OfficialSourceCheck {
  requiredForAutomaticDecision: boolean
}

export interface ClassificationResolution {
  status: ClassificationResolutionStatus
  confidenceLevel?: ClassificationConfidenceLevel
  nextAction: ClassificationNextAction
  candidates: ClassificationCandidate[]
  discrepancies: ClassificationDiscrepancy[]
  reviewReasons: ClassificationReviewReason[]
  proposal?: ClassificationProposal
  automaticSelection?: ClassificationSelection
  finalSelection?: ClassificationSelection
  sourceChecks: ClassificationSourceCheck[]
  officialLinks: OfficialResourceLink[]
  evidence: TerritorialEvidence[]
}

export type UrbanisticFactStatus =
  | 'automatic_confirmed'
  | 'automatic_probable'
  | 'manual_review_required'
  | 'technician_validated'
  | 'not_available'
  | 'source_unavailable'
  | 'conflict'
  | 'not_applicable'

export type UrbanisticFactOrigin =
  | 'automatic_source'
  | 'official_document'
  | 'spatial_intersection'
  | 'structured_catalog'
  | 'technician_selection'
  | 'technician_confirmation'
  | 'conditional_scenario'

export type UrbanisticFactNextAction =
  | 'none'
  | 'review_official_sources'
  | 'manual_selection'
  | 'retry_source'

export interface UrbanisticFactCandidate<T> {
  value: T
  label?: string
  parcelPercentage?: number
  intersectionAreaSquareMetres?: number
}

export interface UrbanisticFact<T> {
  value?: T
  label?: string
  status: UrbanisticFactStatus
  candidates?: UrbanisticFactCandidate<T>[]
  origin?: UrbanisticFactOrigin
  confidence: TerritorialConfidence | 'unknown'
  evidence: TerritorialEvidence[]
  warnings: string[]
  discrepancies: ClassificationDiscrepancy[]
  nextAction: UrbanisticFactNextAction
  resolvedAt?: string
  instrumentId?: string
}

export interface UrbanisticRegimeFacts {
  classification: UrbanisticFact<Pick<PlanningClassification, 'code' | 'label'>>
  category: UrbanisticFact<{
    code: string
    label?: string
  }>
  consolidation: UrbanisticFact<ConsolidationFactValue>
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
  documentType?: PlanningNormativeDocumentType
  preview?: string
}

export interface PlanningApplicability {
  cartographicSourceChecks?: Array<{ provider: string; status: 'available' | 'no_observation' | 'unavailable'; checkedAt: string; reason?: string }>

  status: 'determined' | 'partial' | 'conflict' | 'not_determined'
  instrument?: string
  approvalDate?: string
  sourceUrl?: string
  classification?: PlanningClassification
  classificationResolution?: ClassificationResolution
  urbanisticFacts?: UrbanisticRegimeFacts
  areas?: PlanningArea[]
  applicableInstruments?: PlanningInstrumentReference[]
  cataloguedInstruments?: PlanningInstrumentReference[]
  documents?: PlanningDocumentReference[]
  canAnswerConcreteParameters?: boolean
  conflicts?: string[]
  evidence: TerritorialEvidence[]
  warnings: TerritorialWarning[]
  sourceChecks?: OfficialSourceCheck[]
  resources?: TerritorialResourceCatalog
  /** Raw visual evidence retained even when identity resolution is uncertain. */
  visualResolutionState?: VisualResolutionState
  visualObservations?: VisualZoningObservation[]
  visualExplanation?: string
  /** Canonicalized model proposals, never a user confirmation. */
  visualCandidates?: OrdinanceCandidate[]
  ordinanceCandidates?: OrdinanceCandidate[]
  /** Identities observed in the territorial evidence that are not competing
   * ordinance/zoning alternatives (for example classification or category).
   * They remain available for audit/context without entering ordinance choice. */
  contextualCandidates?: OrdinanceCandidate[]
  /** Normalized product-facing ordinance resolution state. Kept optional for legacy persisted contexts. */
  ordinanceResolution?: OrdinanceResolutionMetadata
  /** Backwards-compatible technical status used by existing consumers. */
  ordinanceResolutionStatus?:
    | 'automatically_determined'
    | 'assisted_confirmation_required'
    | 'manual_confirmation_required'
    | 'ambiguous'
    | 'multizone'
}

export type OrdinanceProductStatus =
  | 'RESOLVED'
  | 'RESOLVED_WITH_PRECISION_WARNING'
  | 'REVIEW_REQUIRED'
  | 'USER_CONFIRMED'

export interface OrdinanceReviewMaterial {
  mapImage?: string
  mapUrl?: string
  parcelOverlay?: string
  overlayUrl?: string
  legendImage?: string
  legendUrl?: string
  candidateOrdinances: Array<{ code: string; label: string; evidence?: string }>
  precisionWarning?: string
  sourceEvidence: string[]
}

export interface OrdinanceResolutionMetadata {
  status: OrdinanceProductStatus
  identity?: { code?: string; label?: string }
  /** Explicit semantic dimension when the identity was recovered from a
   * legacy/continuity record rather than a fully typed candidate. */
  semanticDimension?: Extract<UrbanisticIdentitySemanticType, 'ordinance' | 'zoning'>
  confidence?: TerritorialConfidence | 'unknown'
  source?: string
  provenance: string[]
  alignmentMethod?: string
  estimatedErrorMeters?: number
  warning?: string
  reviewMaterials?: OrdinanceReviewMaterial
  confirmationSource?: 'automatic' | 'user'
  /** Explicit audit marker; never infer this from an AI confidence value. */
  confirmedByUser?: boolean
  contextualCandidates?: OrdinanceCandidate[]
  identityId?: string
  hasEligibility?: any
  normativeReferences?: Array<{
    documentId: string
    chunkIds: string[]
    article?: string
    relation: 'defines' | 'regulates' | 'mentions'
    sourceId: string
  }>
}

/** Canonical dimension of a detected urbanistic identity. Optional for legacy
 * observations; an absent value is intentionally handled conservatively. */
export type UrbanisticIdentitySemanticType =
  | 'classification'
  | 'category'
  | 'qualification'
  | 'zoning'
  | 'ordinance'
  | 'degree'
  | 'area'
  | 'affect'
  | 'protection'
  | 'unknown'

export type VisualResolutionState = 'resolved' | 'multizone' | 'ambiguous' | 'unresolved'

/** Evidence observed by a visual interpreter before it is canonicalized. */
export interface VisualZoningObservation {
  observedText?: string | null
  observedCode?: string | null
  observedNumber?: string | null
  observedLabel?: string | null
  observedSymbols?: string[]
  observedColors?: string[]
  observedPatterns?: string[]
  observedBoundaries?: string[]
  spatialRelation?: 'contains' | 'intersects' | 'ambiguous' | 'unknown'
  parcelRelation?: 'contains' | 'intersects' | 'ambiguous' | 'unknown'
  description?: string
  competingLabels?: string[]
  confidence?: TerritorialConfidence
  semanticDimension?: UrbanisticIdentitySemanticType
  provenance?: string[]
}

export interface VisualZoningInterpretation {
  resolutionState: VisualResolutionState
  observations: VisualZoningObservation[]
  explanation?: string
}

/** Canonical candidate shared by territorial and parcel-context contracts. */
export interface OrdinanceCandidate {
  identity: string
  normalizedIdentity?: string
  semanticDimension?: UrbanisticIdentitySemanticType
  instrumentId: string
  sourceRef?: string
  sourceDocument?: string
  spatialEvidence?: string
  graphicEvidence?: string
  legendEvidence?: string
  documentaryEvidence?: string
  instrumentMembership?: boolean
  provenance: string[]
  coverage?: { percentage?: number; areaSquareMetres?: number; method?: string }
  confidence?: TerritorialConfidence
  status?: 'active' | 'review' | 'user_confirmed'
  competingCandidates?: string[]
  alignmentMethod?: string
  estimatedErrorMeters?: number
  warning?: string
  reason?: string
  reviewMaterials?: OrdinanceReviewMaterial
  confirmationSource?: 'automatic' | 'user'
  /** Stable, instrument-scoped identity from the official catalog. */
  identityId?: string
  catalogStatus?: 'ACCEPTED' | 'REVIEW_REQUIRED' | 'REJECTED'
  normativeReferences?: Array<{
    documentId: string
    chunkIds: string[]
    article?: string
    relation: 'defines' | 'regulates' | 'mentions'
    sourceId: string
  }>
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

export interface ActionAreaSelectionSnapshot {
  id: string
  geometry: ParcelGeometry
  surfaceSquareMetres: number
  parcelSurfaceSquareMetres: number
  selectionType: 'detected_zone' | 'whole_parcel'
  selectedCandidateId?: string
  classification?: string
  category?: string
  planningZone?: string
  planningZones?: string[]
  source: string
  confidence: TerritorialConfidence | 'unknown'
  selectedBy: string
  selectedAt: string
  verification: DeterminationVerification
  affects?: AffectApplicability
}

export interface ActionAreaSelection extends ActionAreaSelectionSnapshot {
  previousSnapshot?: ActionAreaSelectionSnapshot
}

export interface ActionAreaSelectionState {
  current?: ActionAreaSelection
  history: ActionAreaSelectionSnapshot[]
  revokedAt?: string
  revokedBy?: string
}

export interface TerritorialResourceCatalog {
  municipalityCode: string
  instrumentId: string
  source: 'siotuga' | 'arcgis' | 'mixed'
  classificationLayer?: string
  detailedPlanningLayer?: string
  planningTileIndex?: string
  boundaryLayer?: string
  wfsCapabilitiesUrl?: string
  wmsCapabilitiesUrl?: string
  arcGisSources?: ArcGisSourceInfo[]
}

export interface ZoningIdentity {
  code: string | null;
  label: string | null;
  sourceType: 'arcgis_featureserver' | 'arcgis_mapserver' | 'siotuga_wfs' | 'prepared_zoning' | string;
  sourceUrl: string;
  layerId: string | number | null;
  rawAttributes: Record<string, unknown>;
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
  semanticDimension?: UrbanisticIdentitySemanticType;
}

export interface ArcGisSourceInfo {
  url: string;
  sourceType: 'featureserver' | 'mapserver' | 'experience' | 'webmap' | string;
  title?: string;
  provenance?: string[];
  confidence: 'high' | 'medium' | 'low';
}
