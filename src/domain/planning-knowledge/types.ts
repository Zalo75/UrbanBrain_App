export const PLANNING_KNOWLEDGE_SCHEMA_VERSION = 1 as const

export type PlanningKnowledgeValidationStatus =
  | 'discovered'
  | 'candidate'
  | 'ambiguous'
  | 'invalid'

export type PlanningKnowledgeActivationStatus = 'inactive' | 'active'

export interface PredecessorMunicipalityKnowledge {
  municipalityCode: string
  municipalityName: string
  generalInstrumentId: string
  generalInstrumentApprovalDate: string
  classificationLayerName: string
  territorialScopeId: string
}

export interface MunicipalitySuccessionKnowledge {
  currentMunicipalityCode: string
  currentMunicipalityName: string
  constitutedAt: string
  legalBasis: {
    title: string
    officialUrl: string
  }
  predecessors: PredecessorMunicipalityKnowledge[]
}

export type PlanningInstrumentKind =
  | 'general'
  | 'general_modification'
  | 'development'
  | 'historical'
  | 'rural_nucleus_delimitation'

export type PlanningLayerKind =
  | 'classification'
  | 'delimitation'
  | 'planning_tile_index'
  | 'other'

export interface OfficialSourceSnapshot {
  id: string
  provider: 'siotuga'
  url: string
  retrievedAt: string
  mediaType: string
  sha256: string
}

export interface PlanningInstrumentKnowledge {
  officialId: string
  kind: PlanningInstrumentKind
  name: string
  figure: string
  approvalDate?: string
  bopDate?: string
  dogDate?: string
  normativePublicationDate?: string
  legalIncidents?: string
  predecessorMunicipalityCode?: string
  sourceId: string
}

export interface PlanningInstrumentRelation {
  id: string
  fromInstrumentId: string
  toInstrumentId: string
  relation: 'modifies' | 'supersedes' | 'develops' | 'complements' | 'corrects'
  territorialScopeIds: string[]
  precedence: number
  validationStatus: PlanningKnowledgeValidationStatus
  sourceIds: string[]
}

export interface PlanningRegimeIdentifier {
  id: string
  kind: 'classification' | 'category' | 'zone' | 'ordinance' | 'sheet'
  officialCode: string
  label?: string
  layerName: string
  sourceAttribute: string
  instrumentId: string
  validationStatus: PlanningKnowledgeValidationStatus
  sourceIds: string[]
}

export interface PlanningNormativeDocument {
  id: string
  officialDocumentId: string
  instrumentId: string
  name: string
  officialUrl: string
  documentType: 'normative_text' | 'ordinance' | 'sheet' | 'catalogue' | 'other'
  corpusDocumentNames: string[]
  validationStatus: PlanningKnowledgeValidationStatus
  sourceIds: string[]
}

export interface PlanningTerritorialScope {
  id: string
  kind: 'municipality' | 'instrument' | 'modification' | 'development' | 'zone' | 'sheet'
  municipalityCode: string
  predecessorMunicipalityCode?: string
  instrumentId?: string
  layerName?: string
  officialFeatureIds: string[]
  description?: string
  validationStatus: PlanningKnowledgeValidationStatus
  sourceIds: string[]
}

export interface PlanningCompositionRule {
  id: string
  municipalityCode: string
  baseInstrumentId: string
  orderedInstrumentIds: string[]
  territorialScopeIds: string[]
  strategy: 'replace' | 'overlay' | 'complement' | 'manual_review'
  validationStatus: PlanningKnowledgeValidationStatus
  sourceIds: string[]
}

export interface PlanningAuditedException {
  id: string
  municipalityCode: string
  code: string
  explanation: string
  effect: 'disable_automatic_resolution' | 'require_review' | 'override_metadata'
  validFrom: string
  validTo?: string
  validationStatus: PlanningKnowledgeValidationStatus
  sourceIds: string[]
}

export interface PlanningLayerKnowledge {
  name: string
  kind: PlanningLayerKind
  municipalityCode?: string
  instrumentFigure?: string
  instrumentApprovalMonth?: string
  officialDocumentId?: string
  attributes: string[]
  parseStatus: 'parsed' | 'malformed'
  sourceId: string
}

export interface MunicipalityPlanningKnowledge {
  municipalityCode: string
  municipalityName: string
  provinceCode: '15'
  currentPlanning: {
    name: string
    approvalDate: string
    sourceUrl: string
    predecessorMunicipalityCode?: string
    territorialScopeId?: string
  }[]
  municipalSuccession?: MunicipalitySuccessionKnowledge
  instruments: PlanningInstrumentKnowledge[]
  layers: PlanningLayerKnowledge[]
  instrumentRelations: PlanningInstrumentRelation[]
  regimeIdentifiers: PlanningRegimeIdentifier[]
  normativeDocuments: PlanningNormativeDocument[]
  territorialScopes: PlanningTerritorialScope[]
  compositionRules: PlanningCompositionRule[]
  exceptions: PlanningAuditedException[]
  currentInstrumentCandidates: string[]
  technicalPattern:
    | 'single_current_layer'
    | 'multiple_general_versions'
    | 'instrument_composition_required'
    | 'ambiguous_current_planning'
    | 'municipal_succession_scoped'
    | 'malformed_capabilities'
    | 'missing_current_layer'
  validation: {
    status: PlanningKnowledgeValidationStatus
    reasons: string[]
  }
  activation: {
    status: PlanningKnowledgeActivationStatus
    reason: string
  }
  coverage: {
    classification: boolean
    category: boolean
    zoneOrOrdinance: boolean
    normativeDocument: boolean
    endToEndParameters: boolean
    blockers: string[]
  }
  sourceIds: string[]
}

export interface PlanningKnowledgeReleasePayload {
  schemaVersion: typeof PLANNING_KNOWLEDGE_SCHEMA_VERSION
  scope: {
    country: 'ES'
    autonomousCommunity: 'Galicia'
    provinceCode: '15'
    excludedMunicipalityCodes: string[]
  }
  generatedAt: string
  sources: OfficialSourceSnapshot[]
  municipalities: MunicipalityPlanningKnowledge[]
  validation: {
    status: 'draft' | 'blocked' | 'ready_for_review'
    errors: string[]
    warnings: string[]
  }
}

export interface PlanningKnowledgeRelease extends PlanningKnowledgeReleasePayload {
  releaseId: string
  sha256: string
}

export interface RawOfficialSource {
  id: string
  provider: 'siotuga'
  url: string
  retrievedAt: string
  mediaType: string
  content: string
}

export interface PlanningKnowledgeGenerationInput {
  generatedAt: string
  municipalityCatalog: Array<{
    ineCode: string
    name: string
  }>
  currentPlanningRecords: Array<{
    municipalityId: string
    municipalityName: string
    name: string
    approvalDate: string
    sourceUrl: string
  }>
  municipalitySources: Array<{
    municipalityCode: string
    capabilitiesSourceId: string
    capabilitiesXml: string
    inventory: PlanningInstrumentKnowledge[]
    layerSchemas: Record<string, { sourceId: string; xml: string }>
    sourceIds: string[]
  }>
  rawSources: RawOfficialSource[]
  excludedMunicipalityCodes: string[]
}

export interface PlanningKnowledgeReleaseDiff {
  fromReleaseId?: string
  toReleaseId: string
  addedMunicipalities: string[]
  removedMunicipalities: string[]
  changedMunicipalities: Array<{
    municipalityCode: string
    beforeSha256: string
    afterSha256: string
  }>
  addedSources: string[]
  removedSources: string[]
  changedSources: string[]
}
