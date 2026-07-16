import { describe, expect, it } from 'vitest'
import { hasOrganizationPermission, type OrganizationPermission, type OrganizationRole } from './organizationRoles'

const mutations: OrganizationPermission[] = ['expediente.create', 'expediente.edit', 'expediente.archive', 'document.upload', 'document.process', 'context.manual.write', 'context.technical_review']

describe('organization role matrix', () => {
  it.each<OrganizationRole>(['owner', 'admin'])('%s can manage the organization and expedientes', (role) => {
    expect(hasOrganizationPermission(role, 'organization.manage')).toBe(true)
    for (const permission of mutations) expect(hasOrganizationPermission(role, permission)).toBe(true)
  })

  it('allows members to edit operational content but not manage or archive', () => {
    expect(hasOrganizationPermission('member', 'organization.manage')).toBe(false)
    expect(hasOrganizationPermission('member', 'expediente.archive')).toBe(false)
    for (const permission of mutations.filter((value) => value !== 'expediente.archive')) {
      expect(hasOrganizationPermission('member', permission)).toBe(true)
    }
  })

  it('denies every mutation to viewers', () => {
    expect(hasOrganizationPermission('viewer', 'organization.manage')).toBe(false)
    for (const permission of mutations) expect(hasOrganizationPermission('viewer', permission)).toBe(false)
  })
})
