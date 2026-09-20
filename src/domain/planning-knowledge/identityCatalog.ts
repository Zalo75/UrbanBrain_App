import type { UrbanisticIdentitySemanticType, TerritorialConfidence } from '@/domain/territorial-resolver/types'
import type { SemanticCatalogObservation } from './semanticCatalog'

export type CatalogIdentityStatus = 'ACCEPTED' | 'OBSERVED_NOT_ACREDITED' | 'AMBIGUOUS' | 'REVIEW_REQUIRED' | 'REJECTED'
export type RuntimeCatalogStatus = 'ACCEPTED' | 'REVIEW_REQUIRED' | 'REJECTED'

export function runtimeCatalogStatus(status: CatalogIdentityStatus): RuntimeCatalogStatus {
  if (status === 'ACCEPTED') return 'ACCEPTED'
  if (status === 'REJECTED') return 'REJECTED'
  return 'REVIEW_REQUIRED'
}

export interface CatalogNormativeReference {
  documentId: string
  chunkIds: string[]
  article?: string
  relation: 'defines' | 'regulates' | 'mentions'
  sourceId: string
}

export interface CatalogIdentityEvidence {
  sourceId: string
  sourceType?: string
  documentId?: string
  chunkIds?: string[]
  officialDocumentId?: string
  officialUrl?: string
  locator?: string
  quote?: string
  relation?: string
  confidence?: TerritorialConfidence | 'unknown'
}

export interface InstrumentIdentity {
  id: string
  municipalityCode: string
  instrumentId: string
  /** Legacy runtime type is retained for consumer compatibility; serialized semantic dimensions may be open values. */
  semanticDimension: UrbanisticIdentitySemanticType
  /** Original dimension label discovered in the instrument, when it is not one of the runtime dimensions. */
  dimensionLabel?: string
  officialCode: string
  officialName: string
  aliases?: string[]
  status: CatalogIdentityStatus
  evidence: CatalogIdentityEvidence[]
  normativeReferences: CatalogNormativeReference[]
  promotionDecision?: 'NORMATIVE_IDENTITY'
  sourceObservationIds?: string[]
  /** Relationships from global resolution are stored on each identity; there is no root-level field. */
  identityRelations?: Array<{ identityId: string; relation: 'RELATED' | 'AMBIGUOUS_EQUIVALENCE' }>
}

export interface InstrumentIdentityCatalog {
  municipalityCode: string
  instrumentId: string
  identities: InstrumentIdentity[]
  sourceKind?: string
  generatedAt?: string
  schemaVersion?: string
  sourceManifest?: Array<{ documentId: string; url: string; documentType?: string }>
  /** All discovered semantic observations, including concepts not promoted to identities. */
  semanticObservations?: SemanticCatalogObservation[]
}

/** Offline accreditation must include an instrument, an explicit dimension and
 * a traceable documentary locator. Extraction confidence alone is insufficient. */
export function isAccreditedIdentity(identity: InstrumentIdentity): boolean {
  return identity.status === 'ACCEPTED' && Boolean(identity.instrumentId && identity.municipalityCode && identity.officialCode.trim()) &&
    ['classification', 'category', 'scope', 'ordinance', 'zoning', 'development_instrument'].includes(identity.semanticDimension) &&
    identity.evidence.some(e => Boolean(e.sourceId && (e.officialUrl || e.officialDocumentId || e.documentId) && (e.locator || e.quote || e.chunkIds?.length)))
}
