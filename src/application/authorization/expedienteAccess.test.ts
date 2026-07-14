import { beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'

const mocks = vi.hoisted(() => ({
  getUserId: vi.fn(),
  select: vi.fn(),
  from: vi.fn(),
  innerJoin: vi.fn(),
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
    mocks.from.mockReturnValue({ innerJoin: mocks.innerJoin })
    mocks.innerJoin.mockReturnValue({ where: mocks.where })
    mocks.where.mockReturnValue({ limit: mocks.limit })
  })

  it('denies access when the authenticated user has no membership in the expediente organization', async () => {
    mocks.getUserId.mockResolvedValue('user-org-a')
    mocks.limit.mockResolvedValue([])

    const result = await getExpedienteAccess('expediente-org-b')

    expect(result).toEqual({ ok: false, reason: 'not_found_or_forbidden' })
    expect(mocks.innerJoin).toHaveBeenCalledOnce()
  })

  it('joins the requested expediente to the authenticated user membership using the current schema', () => {
    const database = drizzle.mock()

    const query = buildExpedienteAccessQuery(
      database,
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111'
    ).toSQL()

    expect(query.sql).toContain('from "expedientes"')
    expect(query.sql).toContain('inner join "organization_members"')
    expect(query.sql).toContain(
      '"organization_members"."org_id" = "expedientes"."org_id"'
    )
    expect(query.sql).toContain('"organization_members"."profile_id" = $1')
    expect(query.sql).toContain('where "expedientes"."id" = $2')
    expect(query.params).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      1,
    ])
  })

  it('returns the authorized expediente for a legitimate organization member', async () => {
    const expediente = {
      id: 'expediente-org-a',
      orgId: 'org-a',
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

  it('does not query expediente data for an unauthenticated request', async () => {
    mocks.getUserId.mockResolvedValue(null)

    const result = await getExpedienteAccess('expediente-org-b')

    expect(result).toEqual({ ok: false, reason: 'unauthenticated' })
    expect(mocks.select).not.toHaveBeenCalled()
  })
})
