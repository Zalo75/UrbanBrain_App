export const PLATFORM_ADMIN_ROLES = [
  'superadmin',
  'operations',
  'support',
  'readonly',
] as const

export type PlatformAdminRole = (typeof PLATFORM_ADMIN_ROLES)[number]

export const PLATFORM_PERMISSIONS = [
  'control_center.access',
  'admin_audit.read',
  'platform_admin.read',
  'platform_admin.manage',
] as const

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number]

const ALL_PERMISSIONS = new Set<string>(PLATFORM_PERMISSIONS)

export const PLATFORM_ROLE_PERMISSIONS: Readonly<
  Record<PlatformAdminRole, ReadonlySet<PlatformPermission>>
> = {
  superadmin: new Set(PLATFORM_PERMISSIONS),
  operations: new Set([
    'control_center.access',
    'admin_audit.read',
    'platform_admin.read',
  ]),
  support: new Set(['control_center.access']),
  readonly: new Set([
    'control_center.access',
    'admin_audit.read',
    'platform_admin.read',
  ]),
}

export function isPlatformPermission(value: string): value is PlatformPermission {
  return ALL_PERMISSIONS.has(value)
}

export function hasPlatformPermission(role: PlatformAdminRole, permission: string): boolean {
  return (
    isPlatformPermission(permission) && PLATFORM_ROLE_PERMISSIONS[role].has(permission)
  )
}
