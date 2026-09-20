import teoCatalog from './catalogs/teo-27387.json'
import vilaCatalog from './catalogs/vila-23045.json'
import cercedaCatalog from './catalogs/cerceda-22284.json'
import type {
  InstrumentIdentity,
  InstrumentIdentityCatalog,
  CatalogIdentityStatus,
} from '@/domain/planning-knowledge/identityCatalog'
import { isAccreditedIdentity, runtimeCatalogStatus } from '@/domain/planning-knowledge/identityCatalog'
import type { OrdinanceCandidate } from '@/domain/territorial-resolver/types'

type RawCatalog = {
  schemaVersion?: unknown
  municipalityCode?: unknown
  instrumentId?: unknown
  sourceKind?: unknown
  generatedAt?: unknown
  sourceManifest?: unknown
  identities?: unknown
}

export function normalizeCatalog(raw: RawCatalog): InstrumentIdentityCatalog | undefined {
  if (typeof raw.municipalityCode !== 'string' || typeof raw.instrumentId !== 'string' || !Array.isArray(raw.identities)) return undefined
  const municipalityCode = raw.municipalityCode
  const instrumentId = raw.instrumentId
  const identities = raw.identities.flatMap((value): InstrumentIdentity[] => {
    if (!value || typeof value !== 'object') return []
    const item = value as Record<string, unknown>
    if (typeof item.id !== 'string' || typeof item.officialCode !== 'string' || typeof item.officialName !== 'string') return []
    const status = item.status
    if (status !== 'ACCEPTED' && status !== 'OBSERVED_NOT_ACREDITED' && status !== 'AMBIGUOUS' && status !== 'REVIEW_REQUIRED' && status !== 'REJECTED') return []
    const dimension = item.semanticDimension
    if (typeof dimension !== 'string') return []
    const evidence = Array.isArray(item.evidence) ? item.evidence : []
    const references = Array.isArray(item.normativeReferences) ? item.normativeReferences : []
    const id = item.id as string
    const officialCode = item.officialCode as string
    const officialName = item.officialName as string
    return [{
      id,
      municipalityCode,
      instrumentId,
      semanticDimension: dimension as InstrumentIdentity['semanticDimension'],
      dimensionLabel: typeof item.dimensionLabel === 'string' ? item.dimensionLabel : undefined,
      officialCode,
      officialName,
      aliases: Array.isArray(item.aliases) ? item.aliases.filter((alias): alias is string => typeof alias === 'string') : undefined,
      status: status as CatalogIdentityStatus,
      evidence: evidence as InstrumentIdentity['evidence'],
      normativeReferences: references.filter((reference): reference is InstrumentIdentity['normativeReferences'][number] => Boolean(reference && typeof reference === 'object' && typeof (reference as Record<string, unknown>).documentId === 'string' && Array.isArray((reference as Record<string, unknown>).chunkIds) && typeof (reference as Record<string, unknown>).sourceId === 'string')),
    }]
  })
  return {
    municipalityCode: raw.municipalityCode,
    instrumentId: raw.instrumentId,
    identities,
    sourceKind: typeof raw.sourceKind === 'string' ? raw.sourceKind : undefined,
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : undefined,
    schemaVersion: typeof raw.schemaVersion === 'string' ? raw.schemaVersion : undefined,
    sourceManifest: Array.isArray(raw.sourceManifest) ? raw.sourceManifest.filter((item): item is { documentId: string; url: string; documentType?: string } => Boolean(item && typeof item === 'object' && typeof (item as Record<string, unknown>).documentId === 'string' && typeof (item as Record<string, unknown>).url === 'string')) : undefined,
  }
}

const CATALOGS = [normalizeCatalog(teoCatalog as RawCatalog), normalizeCatalog(vilaCatalog as RawCatalog), normalizeCatalog(cercedaCatalog as RawCatalog)].filter(
  (catalog): catalog is InstrumentIdentityCatalog => Boolean(catalog),
)

export function getInstrumentIdentityCatalog(municipalityCode?: string | null, instrumentId?: string | null) {
  const municipality = municipalityCode?.trim()
  const instrument = instrumentId?.trim()
  if (!municipality || !instrument) return undefined
  return CATALOGS.find((catalog) => catalog.municipalityCode === municipality && catalog.instrumentId === instrument)
}

export function getInstrumentIdentityOptions(municipalityCode?: string | null, instrumentId?: string | null) {
  return getInstrumentIdentityCatalog(municipalityCode, instrumentId)?.identities.filter(
    (identity) => (identity.semanticDimension === 'ordinance' || identity.semanticDimension === 'zoning') && isAccreditedIdentity(identity),
  ) ?? []
}

export function findInstrumentIdentity(catalog: InstrumentIdentityCatalog | undefined, value: string | undefined) {
  const normalized = value?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleUpperCase()
  if (!normalized) return undefined
  return catalog?.identities.find((identity) => identity.officialCode.toLocaleUpperCase() === normalized || identity.officialName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleUpperCase() === normalized || identity.aliases?.some((alias) => alias.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleUpperCase() === normalized))
}

/**
 * Resolve a factual identity to one, and only one, accepted catalog entry.
 *
 * This deliberately does not use aliases or fuzzy matching.  Returning
 * undefined for zero or multiple matches keeps the catalog from becoming an
 * authority for an ambiguous (or merely review-required) identity.
 */
export function findAcceptedInstrumentIdentity(
  catalog: InstrumentIdentityCatalog | undefined,
  value: string | undefined,
  semanticDimension: InstrumentIdentity['semanticDimension'],
) {
  const normalized = value?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleUpperCase()
  if (!normalized || (semanticDimension !== 'ordinance' && semanticDimension !== 'zoning')) return undefined

  const matches = catalog?.identities.filter((identity) => {
    const sameOrdinanceFamily =
      (semanticDimension === 'ordinance' || semanticDimension === 'zoning') &&
      (identity.semanticDimension === 'ordinance' || identity.semanticDimension === 'zoning')
    if (!isAccreditedIdentity(identity) || !(identity.semanticDimension === semanticDimension || sameOrdinanceFamily)) return false
    const code = identity.officialCode.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleUpperCase()
    const name = identity.officialName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleUpperCase()
    return code === normalized || name === normalized
  }) ?? []

  return matches.length === 1 ? matches[0] : undefined
}

export function enrichOrdinanceCandidate(candidate: OrdinanceCandidate, catalog: InstrumentIdentityCatalog | undefined): OrdinanceCandidate {
  const identity = findInstrumentIdentity(catalog, candidate.identity)
  if (!identity) return candidate
  return {
    ...candidate,
    identityId: identity.id,
    catalogStatus: runtimeCatalogStatus(identity.status),
    normativeReferences: identity.normativeReferences,
    documentaryEvidence: candidate.documentaryEvidence ?? identity.evidence.map((item) => item.quote).filter((quote): quote is string => Boolean(quote)).join(' | '),
    provenance: [...new Set([...candidate.provenance, ...identity.evidence.map((item) => item.sourceId)])],
  }
}

export function isAutomaticallyAuthoritative(candidate: OrdinanceCandidate | undefined): candidate is OrdinanceCandidate & { identityId: string; catalogStatus: 'ACCEPTED' } {
  return Boolean(candidate?.identityId && candidate.catalogStatus === 'ACCEPTED' && candidate.instrumentMembership !== false)
}
