import { eq } from 'drizzle-orm'

import { authProvider } from '@/infrastructure/auth'
import { db } from '@/infrastructure/db/client'
import { platformAdmins, profiles } from '@/infrastructure/db/schema'

import {
  hasPlatformPermission,
  isPlatformPermission,
  type PlatformAdminRole,
  type PlatformPermission,
} from './platformPermissions'

export type PlatformAdminIdentity = {
  profileId: string
  fullName: string | null
  role: PlatformAdminRole
  createdAt: Date
  lastReviewedAt: Date | null
}

export type PlatformAccessDenialReason =
  | 'unauthenticated'
  | 'not_platform_admin'
  | 'inactive_platform_admin'
  | 'permission_denied'
  | 'unknown_permission'

export type PlatformAccessResult =
  | { ok: true; admin: PlatformAdminIdentity }
  | { ok: false; reason: PlatformAccessDenialReason }

type PlatformAdminRecord = {
  profileId: string
  fullName: string | null
  role: PlatformAdminRole
  active: boolean
  createdAt: Date
  revokedAt: Date | null
  lastReviewedAt: Date | null
}

export type PlatformAccessDependencies = {
  getUserId: () => Promise<string | null>
  findPlatformAdmin: (profileId: string) => Promise<PlatformAdminRecord | null>
}

export function buildPlatformAdminQuery(database: typeof db, profileId: string) {
  return database
    .select({
      profileId: platformAdmins.profileId,
      fullName: profiles.fullName,
      role: platformAdmins.role,
      active: platformAdmins.active,
      createdAt: platformAdmins.createdAt,
      revokedAt: platformAdmins.revokedAt,
      lastReviewedAt: platformAdmins.lastReviewedAt,
    })
    .from(platformAdmins)
    .innerJoin(profiles, eq(profiles.id, platformAdmins.profileId))
    .where(eq(platformAdmins.profileId, profileId))
    .limit(1)
}

const defaultDependencies: PlatformAccessDependencies = {
  getUserId: () => authProvider.getUserId(),
  async findPlatformAdmin(profileId) {
    const [admin] = await buildPlatformAdminQuery(db, profileId)
    return admin ?? null
  },
}

export async function getPlatformAccess(
  permission: PlatformPermission | string,
  dependencies: PlatformAccessDependencies = defaultDependencies
): Promise<PlatformAccessResult> {
  if (!isPlatformPermission(permission)) {
    return { ok: false, reason: 'unknown_permission' }
  }

  const profileId = await dependencies.getUserId()
  if (!profileId) {
    return { ok: false, reason: 'unauthenticated' }
  }

  const admin = await dependencies.findPlatformAdmin(profileId)
  if (!admin) {
    return { ok: false, reason: 'not_platform_admin' }
  }

  if (!admin.active || admin.revokedAt !== null) {
    return { ok: false, reason: 'inactive_platform_admin' }
  }

  if (!hasPlatformPermission(admin.role, permission)) {
    return { ok: false, reason: 'permission_denied' }
  }

  return {
    ok: true,
    admin: {
      profileId: admin.profileId,
      fullName: admin.fullName,
      role: admin.role,
      createdAt: admin.createdAt,
      lastReviewedAt: admin.lastReviewedAt,
    },
  }
}

export class PlatformAuthorizationError extends Error {
  readonly code: PlatformAccessDenialReason

  constructor(code: PlatformAccessDenialReason) {
    super('Platform access denied')
    this.name = 'PlatformAuthorizationError'
    this.code = code
  }
}

export async function requirePlatformPermission(
  permission: PlatformPermission | string
): Promise<PlatformAdminIdentity> {
  const result = await getPlatformAccess(permission)
  if (!result.ok) {
    throw new PlatformAuthorizationError(result.reason)
  }

  return result.admin
}

export function isPlatformAuthorizationError(
  error: unknown
): error is PlatformAuthorizationError {
  return error instanceof PlatformAuthorizationError
}
