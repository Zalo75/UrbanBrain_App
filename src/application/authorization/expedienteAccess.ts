import { and, eq } from 'drizzle-orm'
import type { InferSelectModel } from 'drizzle-orm'

import { authProvider } from '@/infrastructure/auth'
import { db } from '@/infrastructure/db/client'
import { expedientes, organizationMembers } from '@/infrastructure/db/schema'

type Expediente = InferSelectModel<typeof expedientes>

export type ExpedienteAccessResult =
  | {
      ok: true
      userId: string
      orgId: string
      expediente: Expediente
    }
  | {
      ok: false
      reason: 'unauthenticated' | 'not_found_or_forbidden'
    }

export function buildExpedienteAccessQuery(
  database: typeof db,
  expedienteId: string,
  userId: string
) {
  return database
    .select({ expediente: expedientes })
    .from(expedientes)
    .innerJoin(
      organizationMembers,
      and(
        eq(organizationMembers.orgId, expedientes.orgId),
        eq(organizationMembers.profileId, userId)
      )
    )
    .where(eq(expedientes.id, expedienteId))
    .limit(1)
}

/**
 * Loads an expediente only when the authenticated user belongs to its organization.
 * The joined query avoids selecting an arbitrary "first" organization membership.
 */
export async function getExpedienteAccess(
  expedienteId: string
): Promise<ExpedienteAccessResult> {
  const userId = await authProvider.getUserId()

  if (!userId) {
    return { ok: false, reason: 'unauthenticated' }
  }

  const [result] = await buildExpedienteAccessQuery(db, expedienteId, userId)

  if (!result) {
    return { ok: false, reason: 'not_found_or_forbidden' }
  }

  return {
    ok: true,
    userId,
    orgId: result.expediente.orgId,
    expediente: result.expediente,
  }
}
