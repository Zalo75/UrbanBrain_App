import { beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'

const mocks = vi.hoisted(() => ({
  getUserId: vi.fn(),
  select: vi.fn(),
  from: vi.fn(),
  leftJoin: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
}))

vi.mock('@/infrastructure/auth', () => ({
  authProvider: {
    getUserId: mocks.getUserId,
  },
}))

vi.mock('@/infrastructure/db/client', () => ({
  db: {
    select: mocks.select,
  },
}))

import { buildExpedienteAccessQuery, getExpedienteAccess } from './expedienteAccess'

describe('getExpedienteAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.select.mockReturnValue({ from: mocks.from })
    mocks.from.mockReturnValue({ leftJoin: mocks.leftJoin })
    mocks.leftJoin.mockReturnValue({ where: mocks.where })
    mocks.where.mockReturnValue({ limit: mocks.limit })
  })

  it('denies access when the authenticated user is not the expediente owner', async () => {
    mocks.getUserId.mockResolvedValue('user-org-a')
    mocks.limit.mockResolvedValue([])

    const result = await getExpedienteAccess('expediente-org-b')

    expect(result).toEqual({ ok: false, reason: 'not_found_or_forbidden' })
    expect(mocks.leftJoin).toHaveBeenCalledOnce()
  })

  it('requires both the requested expediente and authenticated owner using the current schema', () => {
    const database = drizzle.mock()

    const query = buildExpedienteAccessQuery(
      database,
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111'
    ).toSQL()

    expect(query.sql).toContain('from "expedientes"')
    expect(query.sql).toContain('left join "organization_members"')
    expect(query.sql).toContain(
      '"organization_members"."org_id" = "expedientes"."org_id"'
    )
    expect(query.sql).toContain('"organization_members"."profile_id" = $1')
    expect(query.sql).toContain('"expedientes"."id" = $2')
    expect(query.sql).toContain('"expedientes"."owner_id" = $3')
    expect(query.params).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
      1,
    ])
  })

  it('returns the authorized expediente for a legitimate organization member', async () => {
    const expediente = {
      id: 'expediente-org-a',
      orgId: 'org-a',
      ownerId: 'user-org-a',
      name: 'Proyecto autorizado',
      municipio: 'a_coruna',
    }
    mocks.getUserId.mockResolvedValue('user-org-a')
    mocks.limit.mockResolvedValue([{ expediente, membershipRole: 'member' }])

    const result = await getExpedienteAccess('expediente-org-a')

    expect(result).toEqual({
      ok: true,
      userId: 'user-org-a',
      orgId: 'org-a',
      membershipRole: 'member',
      expediente,
    })
  })

  it('keeps ownership as the access authority when no membership row is available', async () => {
    const expediente = {
      id: 'expediente-owned-a',
      orgId: 'org-a',
      ownerId: 'user-a',
      name: 'Proyecto propio',
    }
    mocks.getUserId.mockResolvedValue('user-a')
    mocks.limit.mockResolvedValue([{ expediente, membershipRole: null }])

    await expect(getExpedienteAccess('expediente-owned-a')).resolves.toMatchObject({
      ok: true,
      userId: 'user-a',
      membershipRole: 'viewer',
      expediente,
    })
  })

  it('does not grant a same-organization admin access to another owner expediente', async () => {
    mocks.getUserId.mockResolvedValue('admin-org-a')
    mocks.limit.mockResolvedValue([])

    await expect(getExpedienteAccess('expediente-owned-by-b')).resolves.toEqual({
      ok: false,
      reason: 'not_found_or_forbidden',
    })
  })

  it('does not query expediente data for an unauthenticated request', async () => {
    mocks.getUserId.mockResolvedValue(null)

    const result = await getExpedienteAccess('expediente-org-b')

    expect(result).toEqual({ ok: false, reason: 'unauthenticated' })
    expect(mocks.select).not.toHaveBeenCalled()
  })
})
