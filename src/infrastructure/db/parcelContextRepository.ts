import { rehydrateDetectionSummary } from '@/application/parcel-context/rehydrateDetectionSummary'
import { and, asc, eq, inArray } from 'drizzle-orm'

import type {
  KnownConstraintInput,
  ParcelExpedienteInput,
  TerritorialDetectionSummary,
} from '@/application/parcel-context/normalizeParcelContext'
import { db } from '@/infrastructure/db/client'
import { latestContextDetectionOrder } from '@/infrastructure/db/contextDetectionOrdering'
import { assessClassificationResolution } from '@/domain/territorial-resolver/classificationDecision'
import { urbanisticFactsFromClassificationResolution } from '@/domain/territorial-resolver/urbanisticFacts'
import type {
  OrdinanceResolutionMetadata,
  OrdinanceCandidate,
  TerritorialResolution,
  UrbanisticRegimeFacts,
} from '@/domain/territorial-resolver/types'
import {
  afeccionTypes,
  chatMessages,
  contextDetections,
  expedienteAfecciones,
  expedientes,
} from '@/infrastructure/db/schema'

export interface AuthorizedParcelInputs {
  expediente: ParcelExpedienteInput & { id: string; orgId: string; ownerId: string }
  detected: TerritorialDetectionSummary | null
  userMessages: string[]
  constraints: KnownConstraintInput[]
  /** Evidencia raw sólo para continuidad interna/reconciliación legacy. */
  legacyAuditRaw?: unknown
  /** @deprecated No usar como verdad territorial. Se mantiene para compatibilidad de tests/engine legacy. */
  latestDetectionRaw?: unknown
}

const TRANSIENT_SOURCE_STATUSES = new Set(['timeout', 'unavailable', 'malformed', 'partial'])

function rawPlanning(raw: unknown): Partial<TerritorialResolution['planning']> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const planning = (raw as Partial<TerritorialResolution>).planning
  return planning && typeof planning === 'object' ? planning : undefined
}

type PlanningWithOrdinanceDetermination = Partial<TerritorialResolution['planning']> & {
  ordinanceDetermination?: {
    candidates?: unknown
  }
}

function isOrdinanceCandidate(value: unknown): value is OrdinanceCandidate {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<OrdinanceCandidate>
  return (
    typeof candidate.identity === 'string' && candidate.identity.trim().length > 0 &&
    typeof candidate.instrumentId === 'string' && candidate.instrumentId.trim().length > 0 &&
    Array.isArray(candidate.provenance) &&
    candidate.provenance.every((item) => typeof item === 'string')
  )
}

function candidateIdentityKey(candidate: OrdinanceCandidate) {
  return [
    candidate.instrumentId.trim(),
    (candidate.semanticDimension ?? '').trim(),
    candidate.identity.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleUpperCase(),
  ].join('|')
}

function sameCandidateIdentity(left: OrdinanceCandidate, right: OrdinanceCandidate) {
  if (
    left.instrumentId.trim() !== right.instrumentId.trim() ||
    left.identity.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleUpperCase() !==
      right.identity.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleUpperCase()
  ) return false
  return !left.semanticDimension || !right.semanticDimension || left.semanticDimension === right.semanticDimension
}

function mergeCandidate(base: OrdinanceCandidate, extra: OrdinanceCandidate): OrdinanceCandidate {
  const merged: OrdinanceCandidate = { ...base }
  const optionalFields: Array<keyof OrdinanceCandidate> = [
    'normalizedIdentity',
    'semanticDimension',
    'sourceRef',
    'sourceDocument',
    'spatialEvidence',
    'graphicEvidence',
    'legendEvidence',
    'documentaryEvidence',
    'instrumentMembership',
    'coverage',
    'confidence',
    'status',
    'alignmentMethod',
    'estimatedErrorMeters',
    'warning',
    'reviewMaterials',
    'confirmationSource',
    'identityId',
    'catalogStatus',
    'normativeReferences',
  ]
  for (const field of optionalFields) {
    if (merged[field] === undefined && extra[field] !== undefined) {
      ;(merged as unknown as Record<string, unknown>)[field] = extra[field]
    }
  }
  const statuses = new Set([base.status, extra.status])
  if (statuses.has('user_confirmed')) merged.status = 'user_confirmed'
  else if (statuses.has('active')) merged.status = 'active'
  else if (statuses.has('review')) merged.status = 'review'
  merged.provenance = [...new Set([...base.provenance, ...extra.provenance])]
  if (base.competingCandidates || extra.competingCandidates) {
    merged.competingCandidates = [...new Set([
      ...(base.competingCandidates ?? []),
      ...(extra.competingCandidates ?? []),
    ])]
  }
  if (base.normativeReferences || extra.normativeReferences) {
    const references = [
      ...(base.normativeReferences ?? []),
      ...(extra.normativeReferences ?? []),
    ]
    const keys = new Set<string>()
    merged.normativeReferences = references.filter((reference) => {
      const key = [
        reference.documentId,
        reference.article ?? '',
        reference.relation,
        reference.sourceId,
        ...reference.chunkIds,
      ].join('|')
      if (keys.has(key)) return false
      keys.add(key)
      return true
    })
  }
  return merged
}

function currentInstrumentIds(planning: PlanningWithOrdinanceDetermination | undefined) {
  return new Set(
    planning?.applicableInstruments
      ?.filter((instrument) => instrument.status === 'current')
      .map((instrument) => instrument.id)
      .filter((id): id is string => Boolean(id)) ?? [],
  )
}

/**
 * Legacy detections have stored the same identities either in the product
 * facing `ordinanceCandidates` field or under the older determination state.
 * Read both representations, keep only structurally valid candidates and
 * merge duplicates without changing their authority/status.
 */
function mergeOrdinanceCandidates(
  candidates: unknown[],
  allowedInstrumentIds?: Set<string>,
) {
  const merged = new Map<string, OrdinanceCandidate>()
  for (const value of candidates) {
    if (!isOrdinanceCandidate(value)) continue
    if (allowedInstrumentIds && allowedInstrumentIds.size > 0 && !allowedInstrumentIds.has(value.instrumentId)) {
      continue
    }
    const key = candidateIdentityKey(value)
    const existingEntry = [...merged.entries()].find(([, candidate]) =>
      sameCandidateIdentity(candidate, value)
    )
    if (existingEntry) {
      merged.set(existingEntry[0], mergeCandidate(existingEntry[1], value))
    } else {
      merged.set(key, value)
    }
  }
  return [...merged.values()]
}

function candidatesFromPlanning(planning: PlanningWithOrdinanceDetermination | undefined) {
  if (!planning) return []
  const allowedInstrumentIds = currentInstrumentIds(planning)
  return mergeOrdinanceCandidates([
    ...(planning.ordinanceCandidates ?? []),
    ...((Array.isArray(planning.ordinanceDetermination?.candidates)
      ? planning.ordinanceDetermination.candidates
      : [])),
  ], allowedInstrumentIds)
}

export function ordinanceSummaryFromRaw(raw: unknown): Partial<TerritorialDetectionSummary> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const result = raw as Partial<TerritorialResolution>
  const effective = result.continuity?.effectiveOfficialContext ?? result
  const candidates = candidatesFromPlanning(effective.planning as PlanningWithOrdinanceDetermination)
  const selected = result.continuity?.manualContext?.ordinanceDetermination?.technician?.value
    ?? result.continuity?.manualContext?.ordinance
  const selectedCandidate = selected
    ? candidates.find((candidate) => candidate.identity.trim().toLocaleUpperCase() === selected.trim().toLocaleUpperCase())
    : undefined
  const technicianSelection = result.continuity?.manualContext?.ordinanceDetermination?.technician
  const legacyUserConfirmation: OrdinanceResolutionMetadata | undefined =
    selected &&
      technicianSelection
      ? {
          status: 'USER_CONFIRMED',
          identity: { code: selected, label: selected },
          confidence: selectedCandidate?.confidence ?? 'unknown',
          provenance: selectedCandidate?.provenance ?? result.planning?.ordinanceResolution?.provenance ?? [],
          confirmationSource: 'user',
          confirmedByUser: true,
        }
      : undefined
  const resolution: OrdinanceResolutionMetadata | undefined =
    result.planning?.ordinanceResolution?.status === 'USER_CONFIRMED'
      ? result.planning.ordinanceResolution
      : legacyUserConfirmation ?? result.planning?.ordinanceResolution
  if (candidates.length === 0 && !resolution) return undefined
  return {
    ordinanceCandidates: candidates,
    ordinanceResolution: resolution,
  }
}

function hasUsefulPlanningEvidence(raw: unknown) {
  const planning = rawPlanning(raw)
  if (!planning) return false
  const derivedOrdinance = ordinanceSummaryFromRaw(raw)
  const detailedEvidence = Boolean(
    (planning.ordinanceCandidates?.length ?? 0) > 0 ||
      (planning.contextualCandidates?.length ?? 0) > 0 ||
      planning.ordinanceResolution?.status === 'USER_CONFIRMED' ||
      planning.ordinanceResolution?.status === 'RESOLVED' ||
      planning.ordinanceResolution?.status === 'RESOLVED_WITH_PRECISION_WARNING' ||
      (derivedOrdinance?.ordinanceCandidates?.length ?? 0) > 0 ||
      derivedOrdinance?.ordinanceResolution?.status === 'USER_CONFIRMED',
  )
  const transient = planning.sourceChecks?.some((check) =>
    TRANSIENT_SOURCE_STATUSES.has(check.status),
  ) ?? false
  return Boolean(
    detailedEvidence ||
      (!transient && planning.status === 'determined'),
  )
}

function hasTransientPlanningFailure(raw: unknown) {
  const planning = rawPlanning(raw)
  return planning?.sourceChecks?.some((check) => TRANSIENT_SOURCE_STATUSES.has(check.status)) ?? false
}

/**
 * A failed recalculation is appended as a new detection row. Keep the latest
 * row for display, but feed continuity the most recent useful row when that
 * latest attempt explicitly records a transient planning failure and contains
 * no useful planning evidence. This is read-only and still subject to the
 * parcel/municipality/instrument guards in attachContinuity.
 */
export function selectContinuityDetectionRaw(
  rows: Array<{ rawResponse: unknown }>,
) {
  const latest = rows[0]?.rawResponse
  if (!latest || !hasTransientPlanningFailure(latest) || hasUsefulPlanningEvidence(latest)) {
    return latest
  }
  return rows.slice(1).map((row) => row.rawResponse).find(hasUsefulPlanningEvidence) ?? latest
}

function landClassFromOfficialCode(code?: string, categoryCode?: string) {
  return code === 'SU'
    ? categoryCode === 'SUSC'
      ? 'urbano_no_consolidado'
      : categoryCode === 'SUC'
        ? 'urbano_consolidado'
        : 'urbano'
    : code === 'SNR'
      ? 'nucleo_rural'
      : code === 'SR'
        ? 'rustico'
        : undefined
}

export function classificationSummaryFromRaw(raw: unknown): Partial<TerritorialDetectionSummary> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const result = raw as Partial<TerritorialResolution>
  const effective = result.continuity?.effectiveOfficialContext ?? result
  const assessment = assessClassificationResolution(
    effective.planning?.classificationResolution
  )
  const explicitOperationalValue = effective.planning?.classificationResolution?.finalSelection?.operationalValue?.trim()
  if (explicitOperationalValue) {
    return {
      landClass: explicitOperationalValue,
      planningCanAnswerConcreteParameters: false,
      classificationDetermination: {
        technician: {
          value: explicitOperationalValue,
          origin: 'technician_selection',
          source: 'manual',
          verification: 'unverified',
          recordedAt: effective.planning?.classificationResolution?.finalSelection?.selectedAt ?? new Date(0).toISOString(),
          recordedBy: effective.planning?.classificationResolution?.finalSelection?.selectedBy ?? 'legacy-reconciliation',
        }
      }
    }
  }
  const automaticLandClass = landClassFromOfficialCode(
    assessment.candidate?.kind === 'official_classification' ? assessment.candidate.classification.code : undefined,
    assessment.candidate?.kind === 'official_classification' ? assessment.candidate.classification.categoryCode : undefined
  )
  if (!automaticLandClass || assessment.level === 'unknown') return undefined
  return {
    landClass: automaticLandClass,
    planningCanAnswerConcreteParameters: true,
    classificationDetermination: {
      automatic: {
        value: automaticLandClass,
        origin: 'automatic',
        source: 'siotuga',
        verification: 'unverified'
      }
    }
  }
}

/** Preserve the canonical municipality identity from the territorial result
 * when hydrating older detection summaries that did not store it. */
export function municipalitySummaryFromRaw(raw: unknown): Partial<TerritorialDetectionSummary> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const result = raw as Partial<TerritorialResolution>
  const effective = result.continuity?.effectiveOfficialContext ?? result
  if (!effective.municipality && !effective.municipalityCode) return undefined
  return {
    municipalityName: effective.municipality,
    municipalityCode: effective.municipalityCode,
  }
}

export function urbanisticFactsFromRaw(raw: unknown): UrbanisticRegimeFacts | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const result = raw as Partial<TerritorialResolution>
  const planning = (result.continuity?.effectiveOfficialContext ?? result).planning
  if (!planning) return undefined
  if (planning.classificationResolution) {
    return urbanisticFactsFromClassificationResolution(planning, result.resolvedAt)
  }
  return planning.urbanisticFacts
}

export function buildAuthorizedExpedienteQuery(
  database: typeof db,
  expedienteId: string,
  userId: string
) {
  return database
    .select({ expediente: expedientes })
    .from(expedientes)
    .where(and(eq(expedientes.id, expedienteId), eq(expedientes.ownerId, userId)))
    .limit(1)
}

export async function loadAuthorizedParcelInputs(
  expedienteId: string,
  userId: string
): Promise<AuthorizedParcelInputs | null> {
  const [authorized] = await buildAuthorizedExpedienteQuery(db, expedienteId, userId)
  if (!authorized) return null

  const [latestDetection, history, constraints] = await Promise.all([
    db
      .select({ summary: contextDetections.summary, rawResponse: contextDetections.rawResponse })
      .from(contextDetections)
      .where(eq(contextDetections.expedienteId, expedienteId))
      .orderBy(...latestContextDetectionOrder())
      .limit(25),
    db
      .select({ content: chatMessages.content })
      .from(chatMessages)
      .where(and(eq(chatMessages.expedienteId, expedienteId), eq(chatMessages.role, 'user')))
      .orderBy(asc(chatMessages.createdAt))
      .limit(100),
    db
      .select({
        name: afeccionTypes.name,
        source: expedienteAfecciones.source,
        confidence: expedienteAfecciones.confidence,
        status: expedienteAfecciones.status,
      })
      .from(expedienteAfecciones)
      .innerJoin(afeccionTypes, eq(afeccionTypes.id, expedienteAfecciones.afeccionTypeId))
      .where(
        and(
          eq(expedienteAfecciones.expedienteId, expedienteId),
          inArray(expedienteAfecciones.status, [
            'detected',
            'confirmed',
            'manual',
            'pending_review',
          ])
        )
      ),
  ])

  const latestDetectionRow = latestDetection[0]
  const storedSummary = latestDetectionRow?.summary as TerritorialDetectionSummary | undefined
  const isVersionedSummary = storedSummary?.schemaVersion === 1
  const derivedMunicipality = isVersionedSummary ? undefined : municipalitySummaryFromRaw(latestDetectionRow?.rawResponse)
  const derivedClassification = isVersionedSummary ? undefined : classificationSummaryFromRaw(latestDetectionRow?.rawResponse)
  const derivedUrbanisticFacts = isVersionedSummary ? undefined : urbanisticFactsFromRaw(latestDetectionRow?.rawResponse)
  const derivedOrdinance = isVersionedSummary ? undefined : ordinanceSummaryFromRaw(latestDetectionRow?.rawResponse)
  const rawEffectivePlanning = rawPlanning(
    (latestDetectionRow?.rawResponse as TerritorialResolution | undefined)?.continuity
      ?.effectiveOfficialContext ?? latestDetectionRow?.rawResponse,
  ) as PlanningWithOrdinanceDetermination | undefined
  const storedDeterminationCandidates = (
    storedSummary?.ordinanceDetermination as unknown as { candidates?: unknown[] } | undefined
  )?.candidates ?? []
  const storedOrdinanceCandidates = mergeOrdinanceCandidates([
    ...(storedSummary?.ordinanceCandidates ?? []),
    ...storedDeterminationCandidates,
  ], currentInstrumentIds(rawEffectivePlanning))
  const derivedOrdinanceCandidates = derivedOrdinance?.ordinanceCandidates ?? []
  const hydratedOrdinanceCandidates = mergeOrdinanceCandidates([
    ...storedOrdinanceCandidates,
    ...derivedOrdinanceCandidates,
  ], currentInstrumentIds(rawEffectivePlanning))
  const legacyDetected: TerritorialDetectionSummary | null = storedSummary?.schemaVersion === 1
    ? storedSummary
    : storedSummary
    ? {
        ...storedSummary,
        municipalityName: storedSummary.municipalityName ?? derivedMunicipality?.municipalityName,
        municipalityCode: storedSummary.municipalityCode ?? derivedMunicipality?.municipalityCode,
        landClass: storedSummary.landClass ?? derivedClassification?.landClass,
        planningCanAnswerConcreteParameters:
          derivedClassification?.planningCanAnswerConcreteParameters ??
          storedSummary.planningCanAnswerConcreteParameters,
        classificationDetermination:
          storedSummary.classificationDetermination ?? derivedClassification?.classificationDetermination,
        urbanisticFacts: derivedUrbanisticFacts ?? storedSummary.urbanisticFacts,
        ordinanceCandidates:
          hydratedOrdinanceCandidates.length > 0
            ? hydratedOrdinanceCandidates
            : storedSummary.ordinanceCandidates ?? derivedOrdinance?.ordinanceCandidates,
        ordinanceResolution:
          derivedOrdinance?.ordinanceResolution?.status === 'USER_CONFIRMED'
            ? derivedOrdinance.ordinanceResolution
            : storedSummary.ordinanceResolution ?? derivedOrdinance?.ordinanceResolution,
      }
    : derivedUrbanisticFacts
      ? {
          ...derivedMunicipality,
          ...derivedOrdinance,
          ordinanceCandidates: hydratedOrdinanceCandidates,
          urbanisticFacts: derivedUrbanisticFacts,
        }
      : derivedMunicipality
        ? {
            ...derivedMunicipality,
            ...derivedOrdinance,
            ordinanceCandidates: hydratedOrdinanceCandidates,
          }
        : null
  // La reconciliación raw ocurre exclusivamente para filas legacy. Una fila
  // versionada ya contiene la verdad operativa completa en `summary`.
  const detected = isVersionedSummary
    ? storedSummary ?? null
    : rehydrateDetectionSummary(legacyDetected, latestDetectionRow?.rawResponse)
  console.log('UB-E2E-TRACE hydrate-detection', JSON.stringify({
    expedienteId,
    hasStoredSummary: Boolean(storedSummary),
    hasRawResponse: Boolean(latestDetectionRow?.rawResponse),
    storedSummaryOrdinanceCandidates: (storedSummary?.ordinanceDetermination?.candidates ?? []).map((candidate) => ({
      identity: candidate.identity,
      semanticDimension: candidate.semanticDimension ?? null,
      sourceRef: candidate.sourceRef,
      sourceDocument: candidate.sourceDocument,
      provenance: candidate.provenance,
    })),
    rawPlanningOrdinanceCandidates: ((latestDetectionRow?.rawResponse as TerritorialResolution | undefined)?.planning?.ordinanceCandidates ?? []).map((candidate) => ({
      identity: candidate.identity,
      semanticDimension: candidate.semanticDimension ?? null,
      sourceRef: candidate.sourceRef,
      sourceDocument: candidate.sourceDocument,
      provenance: candidate.provenance,
    })),
    rawContextualCandidates: ((latestDetectionRow?.rawResponse as TerritorialResolution | undefined)?.planning?.contextualCandidates ?? []).map((candidate) => ({
      identity: candidate.identity,
      semanticDimension: candidate.semanticDimension ?? null,
      sourceRef: candidate.sourceRef,
      provenance: candidate.provenance,
    })),
    hydratedOrdinanceDeterminationCandidates: (detected?.ordinanceDetermination?.candidates ?? []).map((candidate) => ({
      identity: candidate.identity,
      semanticDimension: candidate.semanticDimension ?? null,
      sourceRef: candidate.sourceRef,
      sourceDocument: candidate.sourceDocument,
      provenance: candidate.provenance,
    })),
  }))
  const detectedAffects: KnownConstraintInput[] =
    detected?.affects?.detected?.map((affect) => ({
      name: `${affect.category}: ${affect.name}`,
      source: 'ideg',
      confidence:
        affect.confidence === 'high' ? 0.95 : affect.confidence === 'medium' ? 0.75 : 0.55,
      confirmed: affect.confidence === 'high',
    })) ?? []

  return {
    expediente: authorized.expediente,
    detected,
    userMessages: history.map((message) => message.content),
    constraints: [
      ...constraints.map((constraint) => ({
        name: constraint.name,
        source: constraint.source,
        confidence: constraint.confidence,
        confirmed: constraint.status === 'confirmed' || constraint.status === 'manual',
      })),
      ...detectedAffects,
    ],
    legacyAuditRaw: selectContinuityDetectionRaw(latestDetection),
    latestDetectionRaw: selectContinuityDetectionRaw(latestDetection),
  }
}
