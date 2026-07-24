import { and, desc, eq, ne } from 'drizzle-orm'

import { db } from '@/infrastructure/db/client'
import { expedientes, organizationMembers } from '@/infrastructure/db/schema'

export function buildOwnedExpedientesListQuery(database: typeof db, ownerId: string) {
  return database
    .select({ expediente: expedientes, membershipRole: organizationMembers.role })
    .from(expedientes)
    .leftJoin(
      organizationMembers,
      and(
        eq(organizationMembers.orgId, expedientes.orgId),
        eq(organizationMembers.profileId, ownerId)
      )
    )
    .where(and(eq(expedientes.ownerId, ownerId), ne(expedientes.status, 'archived')))
    .orderBy(desc(expedientes.createdAt))
}

export function buildOwnedRecentExpedientesQuery(database: typeof db, ownerId: string) {
  return database
    .select()
    .from(expedientes)
    .where(eq(expedientes.ownerId, ownerId))
    .orderBy(desc(expedientes.createdAt))
    .limit(5)
}
