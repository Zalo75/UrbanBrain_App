import { and, asc, eq, inArray } from 'drizzle-orm'

import type {
  DetectedParcelInput,
  KnownConstraintInput,
  ParcelExpedienteInput,
} from '@/application/parcel-context/normalizeParcelContext'
import { urbanisticFactsFromClassificationResolution } from '@/domain/territorial-resolver/urbanisticFacts'
import type { PlanningApplicability, UrbanisticRegimeFacts } from '@/domain/territorial-resolver/types'
import { db } from '@/infrastructure/db/client'
import { latestContextDetectionOrder } from '@/infrastructure/db/contextDetectionOrdering'
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

export function urbanisticFactsFromRaw(raw: unknown): UrbanisticRegimeFacts | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const result = raw as {
    planning?: PlanningApplicability
    continuity?: { effectiveOfficialContext?: { planning?: PlanningApplicability } }
    resolvedAt?: string
  }
  const planning = result.continuity?.effectiveOfficialContext?.planning ?? result.planning
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
  const reconstructedUrbanisticFacts = urbanisticFactsFromRaw(latestDetection[0]?.rawResponse)
  const detected: DetectedParcelInput | null = storedSummary
    ? {
        ...storedSummary,
        urbanisticFacts: storedSummary.urbanisticFacts ?? reconstructedUrbanisticFacts,
      }
    : reconstructedUrbanisticFacts
      ? { urbanisticFacts: reconstructedUrbanisticFacts }
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
