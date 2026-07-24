import { and, eq } from 'drizzle-orm'
import type { InferSelectModel } from 'drizzle-orm'

import { authProvider } from '@/infrastructure/auth'
import { db } from '@/infrastructure/db/client'
import { expedientes, organizationMembers } from '@/infrastructure/db/schema'

type Expediente = InferSelectModel<typeof expedientes>
type MembershipRole = InferSelectModel<typeof organizationMembers>['role']

export type ExpedienteAccessResult =
  | {
      ok: true
      userId: string
      orgId: string
      membershipRole: MembershipRole
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
    .select({ expediente: expedientes, membershipRole: organizationMembers.role })
    .from(expedientes)
    .leftJoin(
      organizationMembers,
      and(
        eq(organizationMembers.orgId, expedientes.orgId),
        eq(organizationMembers.profileId, userId)
      )
    )
    .where(and(eq(expedientes.id, expedienteId), eq(expedientes.ownerId, userId)))
    .limit(1)
}

/**
 * Loads an expediente only when the authenticated user is its individual owner.
 * Organization membership is joined only to retain the existing role-based UI rules.
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
    membershipRole: result.membershipRole ?? 'viewer',
    expediente: result.expediente,
  }
}
