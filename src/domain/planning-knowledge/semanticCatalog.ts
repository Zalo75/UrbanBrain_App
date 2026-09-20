import type { CatalogIdentityEvidence, CatalogIdentityStatus, CatalogNormativeReference } from './identityCatalog'

export type SemanticEvidenceKind = 'text' | 'table' | 'legend' | 'map' | 'metadata' | 'ocr'
export type SemanticPromotionDecision = 'NORMATIVE_IDENTITY' | 'CONCEPT_ONLY' | 'UNRESOLVED'

export interface SemanticEvidencePacket {
  packetId: string
  kind: SemanticEvidenceKind
  documentId: string
  officialUrl: string
  page?: number | string
  chunkIds: string[]
  text?: string
  imageDataUrl?: string
  sourceHash?: string
}

export interface SemanticCatalogObservation {
  observationId: string
  surfaceForm: string
  code?: string | null
  name?: string | null
  dimension: { label: string; normalizedType?: string | null }
  /** Surface/document role. Kept open because the instrument may introduce roles we do not know yet. */
  role: string
  /** What the finding is, in the model's open vocabulary. */
  semanticRole: string
  /** How the finding relates territorially to the regulated subject. */
  territorialRelation: { kind: string; scope?: string | null }
  /** Structured assessment; promotionDecision remains only the model proposal. */
  identityAssessment: {
    isTerritorialIdentity: boolean
    characterization: 'direct' | 'indirect' | 'none' | 'uncertain'
    /** Whether evidence demonstrates a reusable axis for retrieving applicable determinations. */
    normativeAxis: 'demonstrated' | 'not_demonstrated' | 'uncertain'
    basis: string
  }
  aliases: string[]
  evidence: Array<{ packetId: string; quote?: string | null; relation: 'defines' | 'regulates' | 'mentions' | 'maps_to' | 'contradicts' }>
  relatedObservations: string[]
  confidence: 'high' | 'medium' | 'low'
  epistemicStatus: CatalogIdentityStatus
  /** Documentary discovery and territorial-identity promotion are separate decisions. This is a proposal, not authorization. */
  promotionDecision: SemanticPromotionDecision
  reasoning?: string
}

export interface SemanticCatalogExtraction {
  observations: SemanticCatalogObservation[]
  warnings: string[]
}

/** Makes model-local observation ids unique when outputs from several batches are combined. */
export function namespaceSemanticObservations(extraction: SemanticCatalogExtraction, batchId: string): SemanticCatalogExtraction {
  const ids = new Map(extraction.observations.map((item) => [item.observationId, `${batchId}:${item.observationId}`]))
  return {
    ...extraction,
    observations: extraction.observations.map((item) => ({
      ...item,
      observationId: ids.get(item.observationId) ?? `${batchId}:${item.observationId}`,
      relatedObservations: item.relatedObservations.map((id) => ids.get(id) ?? `${batchId}:${id}`),
    })),
  }
}

export interface SemanticCatalogModel {
  extract(input: {
    municipalityCode: string
    instrumentId: string
    instrumentVersion?: string | null
    packets: SemanticEvidencePacket[]
  }): Promise<SemanticCatalogExtraction>
}

export interface SemanticCatalogIdentity {
  id: string
  municipalityCode: string
  instrumentId: string
  semanticDimension: string
  officialCode: string
  officialName: string
  aliases: string[]
  status: CatalogIdentityStatus
  dimensionLabel?: string
  evidence: CatalogIdentityEvidence[]
  normativeReferences: CatalogNormativeReference[]
  relatedIdentityIds?: string[]
}
