import type { NormalizedParcelContext } from '@/domain/parcel-context/types'
import type { TerritorialDetectionSummary } from './normalizeParcelContext'
import type {
  PlanningDocumentReference,
  OrdinanceCandidate,
} from '@/domain/territorial-resolver/types'
import {
  findAcceptedInstrumentIdentity,
  findInstrumentIdentity,
  getInstrumentIdentityCatalog,
} from '@/infrastructure/planning-knowledge/PlanningKnowledgeBase'

export interface NormativeSearchScope {
  municipioCodigo: string
  instrumentId?: string
  documentIds?: string[]
  documentNames?: string[]
  ordinance?: string
  planningZone?: string
  classification?: string
  category?: string
  actionAreaId?: string
  actionAreaSelectionType?: string
  actionAreaValidated: boolean
  source: 'automatic' | 'technician_validated'
  confidence: 'confirmed' | 'probable' | 'unknown'
  reason: string
  /** Instrument-scoped catalog identity and exact normative references. */
  identityId?: string
  identityName?: string
  catalogStatus?: 'ACCEPTED'
  /** A technician/user selection, unlike automatic matching, is authoritative
   * for the normative identity but says nothing about its geometric extent. */
  authoritativeSelection?: boolean
  /** Provenance added by the catalog enrichment (the original candidate
   * provenance remains on the normalized territorial context). */
  determinationProvenance?: string[]
  catalogProvenance?: string[]
  normativeReferences?: Array<{
    documentId: string
    chunkIds: string[]
    article?: string
    relation: 'defines' | 'regulates' | 'mentions'
    sourceId: string
  }>
}

interface BuildNormativeSearchScopeInput {
  context: NormalizedParcelContext
  municipioCodigo: string | null
  /** Temporary runtime diagnostics; production callers need not provide it. */
  trace?: (event: string, payload: Record<string, unknown>) => void
  detected?: TerritorialDetectionSummary | null
}

function unique(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))]
}

function corpusDocumentName(document: PlanningDocumentReference) {
  if (/\.pdf$/i.test(document.id.trim())) return document.id.trim()
  try {
    const fileName = decodeURIComponent(new URL(document.sourceUrl).pathname.split('/').pop() ?? '')
    return /\.pdf$/i.test(fileName) ? fileName : undefined
  } catch {
    return undefined
  }
}

function currentInstrumentId(detected: TerritorialDetectionSummary | null | undefined) {
  return detected?.applicableInstruments?.find(
    (instrument) => instrument.status === 'current'
  )?.id
}

function documentsForInstrument(
  detected: TerritorialDetectionSummary | null | undefined,
  instrumentId: string | undefined
) {
  const documents = detected?.planningDocuments ?? []
  return instrumentId
    ? documents.filter((document) => !document.instrumentId || document.instrumentId === instrumentId)
    : documents
}

const NORMATIVE_DOCUMENT_TYPES = new Set([
  'ordinance',
  'normative_text',
  'sheet',
])

function isSearchableNormativeDocument(document: PlanningDocumentReference) {
  return !document.documentType || NORMATIVE_DOCUMENT_TYPES.has(document.documentType)
}

function automaticScopeConfidence(context: NormalizedParcelContext) {
  return context.qualification?.verification === 'confirmed' ||
    context.planningArea?.verification === 'confirmed'
    ? 'confirmed'
    : 'unknown'
}

function isOrdinanceDimension(candidate: OrdinanceCandidate) {
  return candidate.semanticDimension === 'ordinance' || candidate.semanticDimension === 'zoning'
}

function normalizedIdentity(value: string | undefined) {
  return value?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleUpperCase()
}

function candidateFromResolution(
  value: unknown,
  instrumentId: string | undefined,
): OrdinanceCandidate | undefined {
  if (!value || !instrumentId || typeof value !== 'object') return undefined
  const resolution = value as {
    identity?: { code?: unknown; label?: unknown; semanticDimension?: unknown }
    semanticDimension?: unknown
    provenance?: unknown
  }
  const identity = typeof resolution.identity?.code === 'string'
    ? resolution.identity.code.trim()
    : typeof resolution.identity?.label === 'string'
      ? resolution.identity.label.trim()
      : ''
  const semanticDimension = resolution.semanticDimension ?? resolution.identity?.semanticDimension
  if (!identity || (semanticDimension !== 'ordinance' && semanticDimension !== 'zoning')) return undefined
  return {
    identity,
    instrumentId,
    semanticDimension,
    provenance: Array.isArray(resolution.provenance)
      ? resolution.provenance.filter((item): item is string => typeof item === 'string')
      : [],
  }
}

/**
 * Enrich only a factual parcel determination.  The determination comes from
 * the territorial resolver/confirmation state; the catalog merely supplies
 * the instrument-scoped canonical identity and exact references used for
 * retrieval.  Legacy candidates without a known semantic dimension are left
 * untouched rather than guessed into an ordinance.
 */
function resolveCatalogEnrichment({
  catalogMunicipalityCode,
  instrumentId,
  ordinance,
  candidatePool,
  factual,
  authoritativeSelection,
  trace,
}: {
  catalogMunicipalityCode: string
  instrumentId?: string
  ordinance?: string
  candidatePool: OrdinanceCandidate[]
  factual: boolean
  authoritativeSelection: boolean
  trace?: (event: string, payload: Record<string, unknown>) => void
}) {
  if (!factual || !instrumentId || !ordinance) {
    trace?.('catalog-lookup', { executed: false, reason: !factual ? 'NOT_FACTUAL' : !instrumentId ? 'MISSING_INSTRUMENT' : 'MISSING_ORDINANCE' })
    return undefined
  }

  const catalog = getInstrumentIdentityCatalog(catalogMunicipalityCode, instrumentId)
  trace?.('catalog-lookup', {
    executed: true,
    municipalityCode: catalogMunicipalityCode,
    instrumentId,
    ordinance,
    catalogFound: Boolean(catalog),
    catalogIdentityCount: catalog?.identities.length ?? 0,
  })
  const canonicalCandidate = candidatePool.find((candidate) =>
    candidate.instrumentId === instrumentId &&
    candidate.instrumentMembership !== false &&
    candidate.identityId &&
    candidate.catalogStatus === 'ACCEPTED' &&
    normalizedIdentity(candidate.identity) === normalizedIdentity(ordinance)
  )
  const catalogIdentity = canonicalCandidate?.identityId
    ? catalog?.identities.find((identity) => identity.id === canonicalCandidate.identityId)
    : undefined
  if (canonicalCandidate?.identityId && canonicalCandidate.normativeReferences && catalogIdentity?.status === 'ACCEPTED') {
    return {
      identityId: canonicalCandidate.identityId,
      identityName: catalogIdentity?.officialName,
      catalogStatus: 'ACCEPTED' as const,
      normativeReferences: canonicalCandidate.normativeReferences,
      determinationProvenance: canonicalCandidate.provenance,
      catalogProvenance: [...new Set(catalogIdentity?.evidence.map((item) => item.sourceId).filter(Boolean) ?? [])],
    }
  }
  if (canonicalCandidate) {
    trace?.('catalog-match', {
      selected: false,
      reason: !catalogIdentity ? 'RUNTIME_IDENTITY_NOT_IN_CATALOG' : catalogIdentity.status !== 'ACCEPTED' ? 'CATALOG_IDENTITY_NOT_ACCEPTED' : 'RUNTIME_REFERENCES_EMPTY',
      identityId: canonicalCandidate.identityId ?? null,
      catalogStatus: catalogIdentity?.status ?? null,
      runtimeReferenceCount: canonicalCandidate.normativeReferences?.length ?? 0,
    })
  }

  // A confirmed runtime selection may legitimately arrive without the
  // catalog-enriched candidate (legacy persisted rows do this). Recover the
  // canonical identity only for one exact, accepted catalog match; never
  // infer an identity from a fuzzy or ambiguous label.
  const dimensionedRuntimeCandidates = candidatePool.filter((candidate) =>
    candidate.instrumentId === instrumentId &&
    candidate.instrumentMembership !== false &&
    isOrdinanceDimension(candidate) &&
    normalizedIdentity(candidate.identity) === normalizedIdentity(ordinance)
  )
  const catalogMatches = catalog?.identities.filter((identity) =>
    identity.status === 'ACCEPTED' &&
    (identity.semanticDimension === 'ordinance' || identity.semanticDimension === 'zoning') &&
    (normalizedIdentity(identity.officialCode) === normalizedIdentity(ordinance) ||
      normalizedIdentity(identity.officialName) === normalizedIdentity(ordinance))
  ) ?? []
  const directCatalogIdentity = authoritativeSelection
    ? catalogMatches.length === 1
      ? catalogMatches[0]
      : undefined
    : dimensionedRuntimeCandidates.length > 0
      ? findInstrumentIdentity(catalog, ordinance)
      : undefined
  if (
    directCatalogIdentity?.status === 'ACCEPTED' &&
    (directCatalogIdentity.semanticDimension === 'ordinance' || directCatalogIdentity.semanticDimension === 'zoning')
  ) {
    trace?.('catalog-match', {
      selected: true,
      reason: 'EXACT_ACCEPTED_CATALOG_MATCH',
      identityId: directCatalogIdentity.id,
      status: directCatalogIdentity.status,
      normativeReferenceCount: directCatalogIdentity.normativeReferences.length,
    })
    return {
      identityId: directCatalogIdentity.id,
      identityName: directCatalogIdentity.officialName,
      catalogStatus: 'ACCEPTED' as const,
      normativeReferences: directCatalogIdentity.normativeReferences,
      determinationProvenance: [...new Set(dimensionedRuntimeCandidates.flatMap((candidate) => candidate.provenance))],
      catalogProvenance: [...new Set(directCatalogIdentity.evidence.map((item) => item.sourceId).filter(Boolean))],
    }
  }

  const matchingCandidates = candidatePool.filter((candidate) =>
    candidate.instrumentId === instrumentId &&
    candidate.instrumentMembership !== false &&
    isOrdinanceDimension(candidate) &&
    normalizedIdentity(candidate.identity) === normalizedIdentity(ordinance)
  )
  if (matchingCandidates.length === 0) {
    trace?.('catalog-match', { selected: false, reason: 'NO_RUNTIME_CANDIDATE_MATCH', candidateCount: 0 })
    return undefined
  }

  const semanticDimensions = new Set(matchingCandidates.map((candidate) => candidate.semanticDimension))
  if (semanticDimensions.size !== 1) {
    trace?.('catalog-match', { selected: false, reason: 'MULTIPLE_SEMANTIC_DIMENSIONS', candidateCount: matchingCandidates.length })
    return undefined
  }
  const semanticDimension = matchingCandidates[0]?.semanticDimension
  if (!semanticDimension) {
    trace?.('catalog-match', { selected: false, reason: 'MISSING_SEMANTIC_DIMENSION', candidateCount: matchingCandidates.length })
    return undefined
  }

  const identity = findAcceptedInstrumentIdentity(
    catalog,
    ordinance,
    semanticDimension,
  )
  if (!identity) {
    trace?.('catalog-match', { selected: false, reason: 'NO_ACCEPTED_CATALOG_MATCH', candidateCount: matchingCandidates.length, semanticDimension })
    return undefined
  }

  trace?.('catalog-match', { selected: true, identityId: identity.id, status: identity.status, normativeReferenceCount: identity.normativeReferences.length })

  return {
    identityId: identity.id,
    identityName: identity.officialName,
    catalogStatus: identity.status as 'ACCEPTED',
    normativeReferences: identity.normativeReferences,
    determinationProvenance: [...new Set(matchingCandidates.flatMap((candidate) => candidate.provenance))],
    catalogProvenance: [...new Set(identity.evidence.map((item) => item.sourceId).filter(Boolean))],
  }
}

export function buildNormativeSearchScope({
  context,
  municipioCodigo: trustedMunicipioCodigo,
  detected,
  trace,
}: BuildNormativeSearchScopeInput): NormativeSearchScope {
  const municipioCodigo = trustedMunicipioCodigo ?? ''
  const instrumentId = currentInstrumentId(detected)
  const documents = documentsForInstrument(detected, instrumentId)
  const applicableDocuments = documents.filter(
    (document) => document.binding !== 'unverified_for_detected_area'
  )
  const legacyManualOrdinance = detected?.manualContext?.ordinance?.trim()
  const ordinanceDetermination = detected?.manualContext?.ordinanceDetermination?.technician
  const canonicalUserOrdinance =
    detected?.ordinanceResolution?.status === 'USER_CONFIRMED'
      ? detected.ordinanceResolution.identity?.code?.trim() || detected.ordinanceResolution.identity?.label?.trim()
      : undefined
  // Older confirmation rows predate ordinanceResolution in the detection
  // summary/raw result.  The normalized context still carries the selected
  // candidate as a confirmed manual qualification; preserve that authoritative
  // fact rather than treating it as an unverified legacy string.
  const contextUserConfirmedOrdinance =
    context.qualification?.source === 'manual' &&
    context.qualification.verification === 'confirmed'
      ? context.qualification.value.trim()
      : context.ordinanceCandidates?.find(
          (candidate) => candidate.status === 'user_confirmed' && candidate.identity.trim()
        )?.identity.trim()
  const userConfirmedOrdinance = Boolean(
    canonicalUserOrdinance || contextUserConfirmedOrdinance
  )
  const manualOrdinance =
    ordinanceDetermination?.value.trim() ||
    legacyManualOrdinance ||
    canonicalUserOrdinance ||
    contextUserConfirmedOrdinance
  const technicianValidated = Boolean(
    manualOrdinance &&
      (ordinanceDetermination?.verification === 'technician_validated' ||
        (!ordinanceDetermination &&
          detected?.manualContext?.verification === 'technician_validated'))
  )
  const pendingManualOrdinance = Boolean(manualOrdinance && !technicianValidated && !userConfirmedOrdinance)
  const automaticOrdinance =
    !manualOrdinance && context.qualification?.source !== 'manual' && context.qualification?.verification === 'confirmed'
      ? context.qualification.value.trim()
      : !manualOrdinance && detected?.ordinanceResolution?.status === 'RESOLVED'
        ? detected.ordinanceResolution.identity?.code?.trim() || detected.ordinanceResolution.identity?.label?.trim()
        : undefined
  const ordinance = userConfirmedOrdinance
    ? manualOrdinance
    : technicianValidated
      ? manualOrdinance
      : automaticOrdinance
  const catalogCandidatePool: OrdinanceCandidate[] = [
    ...(context.ordinanceCandidates ?? []),
    ...(detected?.ordinanceCandidates ?? []),
    ...[
      candidateFromResolution(detected?.ordinanceResolution, instrumentId),
    ].filter((candidate): candidate is OrdinanceCandidate => Boolean(candidate)),
  ]
  trace?.('scope-input', {
    ordinance: ordinance ?? null,
    semanticDimension:
      detected?.ordinanceResolution?.semanticDimension ??
      detected?.ordinanceResolution?.semanticDimension ?? null,
    instrumentId: instrumentId ?? null,
    municipalityCode: municipioCodigo || null,
    candidatePool: catalogCandidatePool.map((candidate) => ({
      identity: candidate.identity,
      semanticDimension: candidate.semanticDimension ?? null,
      instrumentId: candidate.instrumentId ?? null,
      identityId: candidate.identityId ?? null,
      catalogStatus: candidate.catalogStatus ?? null,
    })),
  })
  const factualOrdinance = Boolean(
    ordinance && (
      userConfirmedOrdinance ||
      technicianValidated ||
      automaticOrdinance ||
      context.qualification?.verification === 'confirmed' ||
      detected?.ordinanceResolution?.status === 'RESOLVED' || detected?.ordinanceResolution?.status === 'RESOLVED_WITH_PRECISION_WARNING'
    )
  )
  const catalogEnrichment = resolveCatalogEnrichment({
    catalogMunicipalityCode: municipioCodigo,
    instrumentId,
    ordinance,
    candidatePool: catalogCandidatePool,
    factual: factualOrdinance,
    authoritativeSelection: userConfirmedOrdinance,
    trace,
  })
  trace?.('catalog-enrichment', {
    attempted: Boolean(factualOrdinance && instrumentId && ordinance),
    catalogMunicipalityCode: municipioCodigo || null,
    instrumentId: instrumentId ?? null,
    ordinance: ordinance ?? null,
    selected: catalogEnrichment ? {
      identityId: catalogEnrichment.identityId,
      catalogStatus: catalogEnrichment.catalogStatus,
      normativeReferenceCount: catalogEnrichment.normativeReferences?.length ?? 0,
    } : null,
  })
  // Preserve canonical catalog evidence across every scope return path. This
  // does not change any applicability/action-area policy; it only prevents an
  // early return from discarding already established identity provenance.
  const catalogScopeFields = {
    identityId: catalogEnrichment?.identityId,
    identityName: catalogEnrichment?.identityName,
    catalogStatus: catalogEnrichment?.catalogStatus,
    authoritativeSelection: userConfirmedOrdinance,
    determinationProvenance: catalogEnrichment?.determinationProvenance,
    catalogProvenance: catalogEnrichment?.catalogProvenance,
    normativeReferences: catalogEnrichment?.normativeReferences,
  }
  // La PKB ya ha vinculado estos documentos al identificador estable del
  // instrumento seleccionado. Delimitan el universo de búsqueda, pero no
  // prueban por sí solos un parámetro urbanístico concreto.
  const searchableDocuments = applicableDocuments.filter(isSearchableNormativeDocument)
  const documentNames = unique(searchableDocuments.map(corpusDocumentName))
  const documentIds = unique(searchableDocuments.map((document) => document.id))
  const planningZone = context.planningArea?.value.trim()
  const actionAreaId = context.actionArea?.value.id
  const actionAreaSelectionType = context.actionArea?.value.selectionType
  const actionAreaValidated =
    !context.actionArea || context.actionArea.verification === 'confirmed'
  const actionAreaScope = { actionAreaId, actionAreaSelectionType }
  const classification = context.urbanisticFacts?.classification.value?.code
  const category = context.urbanisticFacts?.category?.value?.code

  if (!municipioCodigo) {
    return {
      municipioCodigo,
      instrumentId,
      ...catalogScopeFields,
      ...actionAreaScope,
      actionAreaValidated,
      classification,
      category,
      source: technicianValidated ? 'technician_validated' : 'automatic',
      confidence: 'unknown',
      reason: 'No existe un código INE municipal oficial para limitar el corpus.',
    }
  }

  if (!actionAreaValidated) {
    return {
      municipioCodigo,
      instrumentId,
      ...catalogScopeFields,
      documentIds: documentIds.length > 0 ? documentIds : undefined,
      documentNames: documentNames.length > 0 ? documentNames : undefined,
      ordinance: context.qualification?.value.trim(),
      planningZone: context.planningArea?.value.trim() || context.qualification?.value.trim(),
      ...actionAreaScope,
      actionAreaValidated,
      classification,
      category,
      source: 'automatic',
      confidence: automaticScopeConfidence(context),
      reason:
        'Se ha localizado la siguiente regulación en las fuentes citadas. La vinculación de esta regulación con la Zona de trabajo todavía no está técnicamente validada; verifica las fuentes antes de emplear el dato en una decisión profesional.',
    }
  }

  if (pendingManualOrdinance) {
    return {
      municipioCodigo,
      instrumentId,
      ...catalogScopeFields,
      ...actionAreaScope,
      documentIds: documentIds.length > 0 ? documentIds : undefined,
      documentNames: documentNames.length > 0 ? documentNames : undefined,
      ordinance: undefined,
      planningZone: context.planningArea?.value.trim(),
      actionAreaValidated,
      classification,
      category,
      source: 'automatic',
      confidence: 'unknown',
      reason:
        'La ordenanza seleccionada manualmente sigue pendiente de validación técnica y no puede habilitar parámetros urbanísticos concretos.',
    }
  }

  if (ordinance) {
    return {
      municipioCodigo,
      instrumentId,
      ...catalogScopeFields,
      ...actionAreaScope,
      documentIds: documentIds.length > 0 ? documentIds : undefined,
      documentNames: documentNames.length > 0 ? documentNames : undefined,
      ordinance,
      planningZone,
      actionAreaValidated,
      classification,
      category,
      source: technicianValidated ? 'technician_validated' : 'automatic',
      confidence: technicianValidated || userConfirmedOrdinance
        ? 'confirmed'
        : automaticScopeConfidence(context),
      reason: userConfirmedOrdinance
        ? 'La ordenanza fue confirmada por el usuario a partir de una candidata oficial del expediente y limita la recuperación normativa; los parámetros deben seguir acreditándose en la documentación recuperada.'
        : technicianValidated
        ? 'La ordenanza fue validada por el técnico y limita la recuperación normativa.'
        : 'La ordenanza oficial confirmada limita la recuperación normativa.',
    }
  }

  if (documentNames.length > 0) {
    const hasSearchDescriptor = Boolean(planningZone || classification || category)
    return {
      municipioCodigo,
      instrumentId,
      ...catalogScopeFields,
      ...actionAreaScope,
      documentIds,
      documentNames,
      planningZone,
      actionAreaValidated,
      classification,
      category,
      source: 'automatic',
      confidence: automaticScopeConfidence(context),
      reason: hasSearchDescriptor && actionAreaValidated
        ? ''
        : planningZone
        ? `La ordenanza aplicable al ámbito ${planningZone} está pendiente de confirmación técnica.`
        : 'La ordenanza aplicable está pendiente de confirmación técnica.',
    }
  }

  return {
    municipioCodigo,
    instrumentId,
    ...catalogScopeFields,
    ...actionAreaScope,
    ordinance: context.qualification?.value.trim(),
    planningZone: planningZone || context.qualification?.value.trim(),
    actionAreaValidated,
    classification,
    category,
    source: technicianValidated ? 'technician_validated' : 'automatic',
    confidence: 'unknown',
    reason: planningZone || context.qualification?.value.trim()
      ? `El ámbito o calificación no está validado y requiere confirmación técnica.`
      : 'No existe una relación trazable entre la parcela y una ordenanza o documento concreto del corpus.',
  }
}

export function canSearchNormativeInformation(scope: NormativeSearchScope) {
  const hasDescriptor = Boolean(
    scope.ordinance || scope.planningZone || scope.classification || scope.category
  )
  const hasDocumentNames = (scope.documentNames?.length ?? 0) > 0

  return Boolean(
    scope.municipioCodigo &&
    hasDescriptor &&
    hasDocumentNames
  )
}

/**
 * Determines whether the canonical document corpus is safe to search.
 *
 * This is deliberately weaker than canSearchNormativeInformation: a known
 * municipality/instrument/document scope is sufficient for general
 * documentary questions, even when no parcel-specific ordinance or zone has
 * been determined yet. Applicability still gates parcel-specific claims.
 */
export function canSearchDocumentScope(scope: NormativeSearchScope) {
  const hasDocuments = Boolean(
    (scope.documentIds?.length ?? 0) > 0 ||
      (scope.documentNames?.length ?? 0) > 0
  )

  return Boolean(scope.municipioCodigo && scope.instrumentId && hasDocuments)
}

export function canAssertParcelApplicableParameters(scope: NormativeSearchScope) {
  return canSearchNormativeInformation(scope) && scope.actionAreaValidated
}
