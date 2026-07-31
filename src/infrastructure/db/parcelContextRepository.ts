import { and, asc, eq, inArray } from 'drizzle-orm'

import type {
  DetectedParcelInput,
  KnownConstraintInput,
  ParcelExpedienteInput,
} from '@/application/parcel-context/normalizeParcelContext'
import { db } from '@/infrastructure/db/client'
import { latestContextDetectionOrder } from '@/infrastructure/db/contextDetectionOrdering'
import { assessClassificationResolution } from '@/domain/territorial-resolver/classificationDecision'
import { urbanisticFactsFromClassificationResolution } from '@/domain/territorial-resolver/urbanisticFacts'
import type {
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
  detected: DetectedParcelInput | null
  userMessages: string[]
  constraints: KnownConstraintInput[]
  latestDetectionRaw?: unknown
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

export function classificationSummaryFromRaw(raw: unknown): Partial<DetectedParcelInput> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const result = raw as Partial<TerritorialResolution>
  const effective = result.continuity?.effectiveOfficialContext ?? result
  const assessment = assessClassificationResolution(
    effective.planning?.classificationResolution
  )
  const automaticLandClass = landClassFromOfficialCode(
    assessment.candidate?.classification.code,
    assessment.candidate?.classification.categoryCode
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

export function urbanisticFactsFromRaw(raw: unknown): UrbanisticRegimeFacts | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const result = raw as Partial<TerritorialResolution>
  const planning = (result.continuity?.effectiveOfficialContext ?? result).planning
  if (!planning) return undefined
  if (planning.urbanisticFacts) return planning.urbanisticFacts
  return planning.classificationResolution
    ? urbanisticFactsFromClassificationResolution(planning, result.resolvedAt)
    : undefined
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
      .limit(1),
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

  const storedSummary = latestDetection[0]?.summary as DetectedParcelInput | undefined
  const derivedClassification = classificationSummaryFromRaw(latestDetection[0]?.rawResponse)
  const derivedUrbanisticFacts = urbanisticFactsFromRaw(latestDetection[0]?.rawResponse)
  const detected: DetectedParcelInput | null = storedSummary
    ? {
        ...storedSummary,
        landClass: storedSummary.landClass ?? derivedClassification?.landClass,
        planningCanAnswerConcreteParameters:
          derivedClassification?.planningCanAnswerConcreteParameters ??
          storedSummary.planningCanAnswerConcreteParameters,
        classificationDetermination:
          storedSummary.classificationDetermination ?? derivedClassification?.classificationDetermination,
        urbanisticFacts: storedSummary.urbanisticFacts ?? derivedUrbanisticFacts,
      }
    : derivedUrbanisticFacts
      ? { urbanisticFacts: derivedUrbanisticFacts }
      : null
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
    latestDetectionRaw: latestDetection[0]?.rawResponse,
  }
}
