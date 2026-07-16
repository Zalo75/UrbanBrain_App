export type OrganizationRole = 'owner' | 'admin' | 'member' | 'viewer'

export type OrganizationPermission =
  | 'organization.manage'
  | 'expediente.create'
  | 'expediente.edit'
  | 'expediente.archive'
  | 'document.upload'
  | 'document.process'
  | 'context.manual.write'
  | 'context.technical_review'

const rolePermissions: Record<OrganizationRole, ReadonlySet<OrganizationPermission>> = {
  owner: new Set(['organization.manage', 'expediente.create', 'expediente.edit', 'expediente.archive', 'document.upload', 'document.process', 'context.manual.write', 'context.technical_review']),
  admin: new Set(['organization.manage', 'expediente.create', 'expediente.edit', 'expediente.archive', 'document.upload', 'document.process', 'context.manual.write', 'context.technical_review']),
  member: new Set(['expediente.create', 'expediente.edit', 'document.upload', 'document.process', 'context.manual.write', 'context.technical_review']),
  viewer: new Set(),
}

export function hasOrganizationPermission(role: OrganizationRole, permission: OrganizationPermission) {
  return rolePermissions[role].has(permission)
}
