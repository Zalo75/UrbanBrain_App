import { db } from '@/infrastructure/db/client'
import { adminAuditEvents } from '@/infrastructure/db/schema'

import type { PlatformAdminIdentity } from './platformAccess'
import type { PlatformPermission } from './platformPermissions'

const SECRET_KEY = /secret|token|password|authorization|cookie|api[-_]?key/i
const CONTENT_KEY =
  /(^|[_-])(prompt|question|content)([_-]|$)|(prompt|question|conversation|message)(text|body|content)/i
const MAX_STRING_LENGTH = 500
const MAX_ARRAY_LENGTH = 20
const MAX_DEPTH = 3

type SafeAuditValue = string | number | boolean | null | SafeAuditValue[] | SafeAuditMetadata
export type SafeAuditMetadata = { [key: string]: SafeAuditValue }

export type AdminAuditInput = {
  action: string
  permission?: PlatformPermission
  resourceType: string
  resourceId?: string
  organizationId?: string
  result: 'success' | 'denied' | 'error'
  reason?: string
  correlationId?: string
  metadata?: Record<string, unknown>
}

function sanitizeValue(value: unknown, depth: number): SafeAuditValue | undefined {
  if (depth > MAX_DEPTH || value === undefined) return undefined
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return value.slice(0, MAX_STRING_LENGTH)
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_LENGTH)
      .map((item) => sanitizeValue(item, depth + 1))
      .filter((item): item is SafeAuditValue => item !== undefined)
  }
  if (typeof value === 'object') {
    return sanitizeAuditMetadata(value as Record<string, unknown>, depth + 1)
  }
  return undefined
}

export function sanitizeAuditMetadata(
  metadata: Record<string, unknown>,
  depth = 0
): SafeAuditMetadata {
  if (depth > MAX_DEPTH) return {}

  return Object.fromEntries(
    Object.entries(metadata).flatMap(([key, value]) => {
      if (SECRET_KEY.test(key) || CONTENT_KEY.test(key)) return []
      const sanitized = sanitizeValue(value, depth)
      return sanitized === undefined ? [] : [[key, sanitized]]
    })
  )
}

/**
 * Persists an explicit administrative action. Page renders are deliberately
 * excluded: reads must not create side effects during React rendering.
 */
export async function recordAdminAuditEvent(
  actor: PlatformAdminIdentity,
  input: AdminAuditInput
): Promise<void> {
  await db.insert(adminAuditEvents).values({
    actorProfileId: actor.profileId,
    actorRole: actor.role,
    action: input.action,
    permission: input.permission,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    organizationId: input.organizationId,
    result: input.result,
    reason: input.reason,
    correlationId: input.correlationId,
    metadata: sanitizeAuditMetadata(input.metadata ?? {}),
  })
}
