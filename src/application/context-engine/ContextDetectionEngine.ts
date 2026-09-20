import { detectionSummary } from '@/application/parcel-context/detectionSummary'
import { resolveParcelLocation } from '@/application/territorial-resolver/resolveParcelLocation'
import type {
  ManualTerritorialContext,
  ResolveParcelLocationInput,
  TerritorialResolution,
} from '@/domain/territorial-resolver/types'
import { findInstrumentIdentity, getInstrumentIdentityCatalog } from '@/infrastructure/planning-knowledge/PlanningKnowledgeBase'
import { runtimeCatalogStatus } from '@/domain/planning-knowledge/identityCatalog'
import {
  attachContinuity,
  createManualAttempt,
  officialContextForUse,
  targetsSameParcel,
} from '@/application/territorial-resolver/territorialContinuity'
import {
  createTechnicianDetermination,
} from '@/domain/territorial-resolver/determinations'
import { db } from '@/infrastructure/db/client'
import { contextDetections, expedientes } from '@/infrastructure/db/schema'
import { and, eq } from 'drizzle-orm'
import { loadAuthorizedParcelInputs } from '@/infrastructure/db/parcelContextRepository'
import { CatastroOfficialAdapter } from '@/infrastructure/territorial-resolver/CatastroOfficialAdapter'
import { CartoCiudadOfficialAdapter } from '@/infrastructure/territorial-resolver/CartoCiudadOfficialAdapter'
import { DatabasePlanningAdapter } from '@/infrastructure/territorial-resolver/DatabasePlanningAdapter'
import { BetanzosPlanningAdapter } from '@/infrastructure/territorial-resolver/BetanzosPlanningAdapter'
import { SiotugaClassificationSourceAdapter } from '@/infrastructure/territorial-resolver/SiotugaClassificationAdapter'
import { MultiSourceClassificationResolver } from '@/application/territorial-resolver/multiSourceClassificationResolver'
import { IdegAffectAdapter } from '@/infrastructure/territorial-resolver/IdegAffectAdapter'

type Resolver = (input: ResolveParcelLocationInput) => Promise<TerritorialResolution>

function canonicalLocationInput(input: ResolveParcelLocationInput): ResolveParcelLocationInput {
  if (input.cadastralReference) return { cadastralReference: input.cadastralReference }
  if (input.coordinates) return { coordinates: input.coordinates }
  if (input.address?.trim()) return { address: input.address.trim() }
  return {}
}

function officialResolver(): Resolver {
  const dependencies = {
    catastro: new CatastroOfficialAdapter(),
    geocoder: new CartoCiudadOfficialAdapter(),
    planning: new MultiSourceClassificationResolver(
      new BetanzosPlanningAdapter(new DatabasePlanningAdapter()),
      [{
        id: 'SIOTUGA WFS',
        source: 'siotuga',
        adapter: new SiotugaClassificationSourceAdapter(),
        requiredForAutomaticDecision: true,
      }]
    ),
    affects: new IdegAffectAdapter(),
  }
  return (input) => resolveParcelLocation(input, dependencies)
}


export class ContextDetectionEngine {
  constructor(private readonly resolver: Resolver = officialResolver()) {}

  async detectContext(expedienteId: string, userId: string): Promise<TerritorialResolution | null> {
    const attemptStartedAt = new Date().toISOString()
    const authorized = await loadAuthorizedParcelInputs(expedienteId, userId)
    if (!authorized) return null

    return this.resolveAndPersist(expedienteId, authorized, {
      ...canonicalLocationInput({
        cadastralReference: authorized.expediente.refCatastral,
        coordinates:
          authorized.expediente.lat !== null && authorized.expediente.lng !== null
            ? { lat: authorized.expediente.lat!, lng: authorized.expediente.lng! }
            : undefined,
        address: authorized.expediente.address,
      }),
      declaredMunicipality: authorized.expediente.municipio,
    }, attemptStartedAt)
  }

  async detectContextFromInput(
    expedienteId: string,
    userId: string,
    input: ResolveParcelLocationInput,
    attemptStartedAt = new Date().toISOString()
  ): Promise<TerritorialResolution | null> {
    const authorized = await loadAuthorizedParcelInputs(expedienteId, userId)
    if (!authorized) return null
    return this.resolveAndPersist(expedienteId, authorized, {
      ...canonicalLocationInput(input),
      declaredMunicipality: authorized.expediente.municipio,
    }, attemptStartedAt)
  }

  /**
   * Persists a pre-creation resolution only after confirming that the caller may
   * write context for the newly-created expediente. This avoids repeating the
   * official queries already performed immediately before creation.
   */
  async persistAuthorizedDetection(
    expedienteId: string,
    userId: string,
    result: TerritorialResolution
  ): Promise<boolean> {
    const authorized = await loadAuthorizedParcelInputs(expedienteId, userId)
    if (!authorized) return false
    await this.persist(expedienteId, authorized.expediente.ownerId, result)
    return true
  }

  async recordManualContext(
    expedienteId: string,
    userId: string,
    input: ResolveParcelLocationInput,
    manualContext: ManualTerritorialContext
  ): Promise<TerritorialResolution | null> {
    const authorized = await loadAuthorizedParcelInputs(expedienteId, userId)
    if (!authorized) return null
    const continuityRaw = authorized.legacyAuditRaw ?? authorized.latestDetectionRaw
    const result = createManualAttempt(input, manualContext, continuityRaw)
    await this.persist(expedienteId, authorized.expediente.ownerId, result)
    return result
  }

  /**
   * Confirms one of the already detected ordinance candidates.  This is an
   * explicitly local operation: it reads the latest authorized detection,
   * verifies the selected identity belongs to that same official context and
   * persists a manual confirmation without invoking any external resolver.
   */
  async confirmOrdinanceCandidate(
    expedienteId: string,
    userId: string,
    input: ResolveParcelLocationInput,
    identity: string,
    recordedAt = new Date().toISOString(),
  ): Promise<TerritorialResolution | null> {
    const authorized = await loadAuthorizedParcelInputs(expedienteId, userId)
    if (!authorized) return null

    const previousRaw = (authorized.legacyAuditRaw ?? authorized.latestDetectionRaw) as TerritorialResolution | undefined
    const official = previousRaw ? officialContextForUse(previousRaw) : undefined
    if (!official || !targetsSameParcel(input, official)) return null
    const detectedCandidate = official?.planning.ordinanceCandidates?.find(
      (item) => item.identity
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLocaleUpperCase() === identity
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLocaleUpperCase(),
    )
    const instrumentId = official.planning.applicableInstruments?.find((item) => item.status === 'current')?.id ?? official.planning.instrument
    const catalogIdentity = findInstrumentIdentity(getInstrumentIdentityCatalog(official.municipalityCode, instrumentId), identity)
    const candidate = detectedCandidate ?? (catalogIdentity ? {
      identity: catalogIdentity.officialCode,
      normalizedIdentity: catalogIdentity.officialCode,
      semanticDimension: catalogIdentity.semanticDimension,
      instrumentId: instrumentId ?? official.planning.instrument ?? '',
      instrumentMembership: true,
      provenance: catalogIdentity.evidence.map((item) => item.sourceId),
      documentaryEvidence: catalogIdentity.evidence.map((item) => item.quote).filter((quote): quote is string => Boolean(quote)).join(' | '),
      identityId: catalogIdentity.id,
      catalogStatus: runtimeCatalogStatus(catalogIdentity.status),
      normativeReferences: catalogIdentity.normativeReferences,
    } satisfies NonNullable<TerritorialResolution['planning']['ordinanceCandidates']>[number] : undefined)
    if (!candidate) return null

    const previousManual = previousRaw?.continuity?.manualContext
    const manualContext: ManualTerritorialContext = {
      ...previousManual,
      cadastralReference:
        previousManual?.cadastralReference ?? input.cadastralReference ?? official.cadastralReference,
      municipality: previousManual?.municipality ?? official.municipality,
      address: previousManual?.address ?? input.address ?? official.normalizedAddress,
      coordinates: previousManual?.coordinates ?? input.coordinates ?? official.coordinates,
      ordinance: candidate.identity,
      ordinanceDetermination: {
        ...previousManual?.ordinanceDetermination,
        technician: createTechnicianDetermination(
          candidate.identity,
          userId,
          official.planning.ordinanceResolution?.identity?.code,
          { verification: 'unverified', now: () => new Date(recordedAt) },
        ),
      },
      provenance: 'manual',
      verification: previousManual?.verification ?? 'unverified',
      recordedAt,
      validatedAt: previousManual?.validatedAt,
      validatedBy: previousManual?.validatedBy,
    }

    const result = createManualAttempt(input, manualContext, previousRaw)
    // Keep the official candidate set and make the explicit user confirmation
    // part of the persisted territorial result.  Chat can then consume this
    // fact without re-running any external resolver; the selected identity is
    // still the exact candidate from the same official context.
    const confirmedCandidates = (official.planning.ordinanceCandidates ?? []).map((item) =>
      item.identity.trim().toLocaleUpperCase() === candidate.identity.trim().toLocaleUpperCase()
        ? { ...item, status: 'user_confirmed' as const, confirmationSource: 'user' as const }
        : item
    )
    if (!detectedCandidate) confirmedCandidates.push({ ...candidate, status: 'user_confirmed', confirmationSource: 'user' })
    result.planning = {
      ...official.planning,
      ordinanceCandidates: confirmedCandidates,
      ordinanceResolution: {
        ...official.planning.ordinanceResolution,
        status: 'USER_CONFIRMED',
        identity: {
          code: candidate.identity,
          label: candidate.identity,
        },
        confidence: candidate.confidence ?? official.planning.ordinanceResolution?.confidence ?? 'unknown',
        provenance: candidate.provenance,
        confirmationSource: 'user',
        confirmedByUser: true,
        identityId: candidate.identityId,
        normativeReferences: candidate.normativeReferences,
      },
    }
    await this.persist(expedienteId, authorized.expediente.ownerId, result)
    return result
  }

  private async resolveAndPersist(
    expedienteId: string,
    authorized: NonNullable<Awaited<ReturnType<typeof loadAuthorizedParcelInputs>>>,
    input: ResolveParcelLocationInput,
    attemptStartedAt: string
  ) {
    const current = await this.resolver(input)
    console.log('UB-E2E-TRACE resolve-result-before-continuity', JSON.stringify({
      expedienteId,
      attemptStartedAt,
      municipalityCode: current.municipalityCode ?? null,
      ordinanceCandidates: current.planning.ordinanceCandidates?.map((candidate) => ({
        identity: candidate.identity,
        semanticDimension: candidate.semanticDimension ?? null,
        sourceRef: candidate.sourceRef,
        sourceDocument: candidate.sourceDocument,
        provenance: candidate.provenance,
      })) ?? [],
      contextualCandidates: current.planning.contextualCandidates?.map((candidate) => ({
        identity: candidate.identity,
        semanticDimension: candidate.semanticDimension ?? null,
        sourceRef: candidate.sourceRef,
        provenance: candidate.provenance,
      })) ?? [],
    }))
    current.attemptStartedAt = attemptStartedAt
    const result = attachContinuity(current, input, authorized.legacyAuditRaw ?? authorized.latestDetectionRaw)
    await this.persist(expedienteId, authorized.expediente.ownerId, result)
    return result
  }

  private async persist(expedienteId: string, ownerId: string, result: TerritorialResolution) {
    console.log('UB-E2E-TRACE persist-result', JSON.stringify({
      expedienteId,
      resolvedAt: result.resolvedAt,
      ordinanceCandidates: result.planning.ordinanceCandidates?.map((candidate) => ({
        identity: candidate.identity,
        semanticDimension: candidate.semanticDimension ?? null,
        sourceRef: candidate.sourceRef,
        sourceDocument: candidate.sourceDocument,
        provenance: candidate.provenance,
      })) ?? [],
      contextualCandidates: result.planning.contextualCandidates?.map((candidate) => ({
        identity: candidate.identity,
        semanticDimension: candidate.semanticDimension ?? null,
        sourceRef: candidate.sourceRef,
        provenance: candidate.provenance,
      })) ?? [],
    }))
    const effective = officialContextForUse(result)
    const allEvidence = [
      ...result.evidence,
      ...result.planning.evidence,
      ...result.affects.detected.map((affect) => affect.evidence),
      ...(effective && effective !== result
        ? [
            ...effective.evidence,
            ...effective.planning.evidence,
            ...effective.affects.detected.map((affect) => affect.evidence),
          ]
        : []),
    ]
    await db.insert(contextDetections).values({
      expedienteId,
      summary: detectionSummary(result),
      rawResponse: result,
      geometryStored: Boolean(effective?.parcelGeometry),
      sourceApis: [...new Set(allEvidence.map((item) => item.source))],
    })
    await db
      .update(expedientes)
      .set({ status: 'active' })
      .where(
        and(
          eq(expedientes.id, expedienteId),
          eq(expedientes.ownerId, ownerId),
          eq(expedientes.status, 'territorial_context_pending')
        )
      )
  }

  async detectStateless(
    input: ResolveParcelLocationInput | string
  ): Promise<TerritorialResolution> {
    return this.resolver(typeof input === 'string' ? { cadastralReference: input } : input)
  }
}
