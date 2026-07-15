import { describe, expect, it } from 'vitest'

import {
  PLATFORM_PERMISSIONS,
  hasPlatformPermission,
  isPlatformPermission,
  type PlatformAdminRole,
  type PlatformPermission,
} from './platformPermissions'

const expectedPermissions: Record<PlatformAdminRole, PlatformPermission[]> = {
  superadmin: [...PLATFORM_PERMISSIONS],
  operations: ['control_center.access', 'admin_audit.read', 'platform_admin.read'],
  support: ['control_center.access'],
  readonly: ['control_center.access', 'admin_audit.read', 'platform_admin.read'],
}

describe('platform permission matrix', () => {
  it.each(Object.entries(expectedPermissions))(
    'grants only the declared permissions to %s',
    (role, granted) => {
      for (const permission of PLATFORM_PERMISSIONS) {
        expect(hasPlatformPermission(role as PlatformAdminRole, permission)).toBe(
          granted.includes(permission)
        )
      }
    }
  )

  it('allows only superadmin to manage platform administrators', () => {
    expect(hasPlatformPermission('superadmin', 'platform_admin.manage')).toBe(true)
    expect(hasPlatformPermission('operations', 'platform_admin.manage')).toBe(false)
    expect(hasPlatformPermission('support', 'platform_admin.manage')).toBe(false)
    expect(hasPlatformPermission('readonly', 'platform_admin.manage')).toBe(false)
  })

  it('fails closed for a permission not present in the single source of truth', () => {
    expect(isPlatformPermission('client.supplied.permission')).toBe(false)
    expect(hasPlatformPermission('superadmin', 'client.supplied.permission')).toBe(false)
  })
})
