import { drizzle } from 'drizzle-orm/postgres-js'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/infrastructure/auth', () => ({
  authProvider: { getUserId: vi.fn() },
}))
vi.mock('@/infrastructure/db/client', () => ({ db: {} }))

import {
  buildPlatformAdminQuery,
  getPlatformAccess,
  type PlatformAccessDependencies,
} from './platformAccess'
import { PLATFORM_PERMISSIONS, type PlatformAdminRole } from './platformPermissions'

const NOW = new Date('2026-07-15T12:00:00.000Z')

function adminRecord(role: PlatformAdminRole, overrides: Record<string, unknown> = {}) {
  return {
    profileId: 'authenticated-profile-id',
    fullName: 'Synthetic administrator',
    role,
    active: true,
    createdAt: NOW,
    revokedAt: null,
    lastReviewedAt: null,
    ...overrides,
  }
}

function dependencies(
  record: ReturnType<typeof adminRecord> | null,
  profileId: string | null = 'authenticated-profile-id'
): PlatformAccessDependencies {
  return {
    getUserId: vi.fn().mockResolvedValue(profileId),
    findPlatformAdmin: vi.fn().mockResolvedValue(record),
  }
}

describe('platform access guard', () => {
  it('denies an unauthenticated request without querying platform administrators', async () => {
    const deps = dependencies(null, null)

    await expect(getPlatformAccess('control_center.access', deps)).resolves.toEqual({
      ok: false,
      reason: 'unauthenticated',
    })
    expect(deps.findPlatformAdmin).not.toHaveBeenCalled()
  })

  it('denies a normal authenticated user', async () => {
    await expect(
      getPlatformAccess('control_center.access', dependencies(null))
    ).resolves.toEqual({ ok: false, reason: 'not_platform_admin' })
  })

  it('does not treat organization_members.role = admin as a platform role', async () => {
    const deps = dependencies(null)

    await expect(getPlatformAccess('control_center.access', deps)).resolves.toEqual({
      ok: false,
      reason: 'not_platform_admin',
    })
    expect(deps.findPlatformAdmin).toHaveBeenCalledWith('authenticated-profile-id')
  })

  it.each([
    adminRecord('superadmin', { active: false, revokedAt: NOW }),
    adminRecord('superadmin', { active: true, revokedAt: NOW }),
  ])('denies inactive or revoked platform administrators', async (record) => {
    await expect(
      getPlatformAccess('control_center.access', dependencies(record))
    ).resolves.toEqual({ ok: false, reason: 'inactive_platform_admin' })
  })

  it('allows readonly basic access but denies administrator management', async () => {
    const record = adminRecord('readonly')

    await expect(
      getPlatformAccess('control_center.access', dependencies(record))
    ).resolves.toMatchObject({ ok: true, admin: { role: 'readonly' } })
    await expect(
      getPlatformAccess('platform_admin.manage', dependencies(record))
    ).resolves.toEqual({ ok: false, reason: 'permission_denied' })
  })

  it('limits support to the basic Control Center permission', async () => {
    const record = adminRecord('support')

    await expect(
      getPlatformAccess('control_center.access', dependencies(record))
    ).resolves.toMatchObject({ ok: true, admin: { role: 'support' } })
    await expect(
      getPlatformAccess('admin_audit.read', dependencies(record))
    ).resolves.toEqual({ ok: false, reason: 'permission_denied' })
  })

  it('allows operations to inspect foundation data but not manage roles', async () => {
    const record = adminRecord('operations')

    for (const permission of [
      'control_center.access',
      'admin_audit.read',
      'platform_admin.read',
    ] as const) {
      await expect(getPlatformAccess(permission, dependencies(record))).resolves.toMatchObject({
        ok: true,
        admin: { role: 'operations' },
      })
    }
    await expect(
      getPlatformAccess('platform_admin.manage', dependencies(record))
    ).resolves.toEqual({ ok: false, reason: 'permission_denied' })
  })

  it('allows superadmin every permission defined by CC-01', async () => {
    const record = adminRecord('superadmin')

    for (const permission of PLATFORM_PERMISSIONS) {
      await expect(getPlatformAccess(permission, dependencies(record))).resolves.toMatchObject({
        ok: true,
        admin: { role: 'superadmin' },
      })
    }
  })

  it('rejects an unknown client-controlled permission before reading identity or data', async () => {
    const deps = dependencies(adminRecord('superadmin'))

    await expect(
      getPlatformAccess('platform_admin.manage&role=superadmin', deps)
    ).resolves.toEqual({ ok: false, reason: 'unknown_permission' })
    expect(deps.getUserId).not.toHaveBeenCalled()
    expect(deps.findPlatformAdmin).not.toHaveBeenCalled()
  })

  it('derives the lookup identity only from the authenticated session', async () => {
    const deps = dependencies(adminRecord('readonly'), 'session-owned-profile-id')

    await getPlatformAccess('control_center.access', deps)

    expect(deps.findPlatformAdmin).toHaveBeenCalledWith('session-owned-profile-id')
  })

  it('queries only the platform table and profile identity, never tenant memberships', () => {
    const query = buildPlatformAdminQuery(
      drizzle.mock(),
      '11111111-1111-4111-8111-111111111111'
    ).toSQL()

    expect(query.sql).toContain('from "platform_admins"')
    expect(query.sql).toContain('inner join "profiles"')
    expect(query.sql).toContain('"platform_admins"."profile_id" = $1')
    expect(query.sql).not.toContain('organization_members')
    expect(query.sql).not.toContain('email')
  })
})
