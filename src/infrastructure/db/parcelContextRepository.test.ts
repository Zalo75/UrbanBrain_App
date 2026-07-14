import { beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  from: vi.fn(),
  innerJoin: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
}))

vi.mock('@/infrastructure/db/client', () => ({ db: { select: mocks.select } }))

import {
  buildAuthorizedExpedienteQuery,
  loadAuthorizedParcelInputs,
} from './parcelContextRepository'

describe('parcelContextRepository multitenancy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.select.mockReturnValue({ from: mocks.from })
    mocks.from.mockReturnValue({ innerJoin: mocks.innerJoin })
    mocks.innerJoin.mockReturnValue({ where: mocks.where })
    mocks.where.mockReturnValue({ limit: mocks.limit })
  })

  it('no carga contexto ni historial cuando el usuario A no pertenece a la organización B', async () => {
    mocks.limit.mockResolvedValue([])

    const result = await loadAuthorizedParcelInputs('expediente-org-b', 'user-org-a')

    expect(result).toBeNull()
    expect(mocks.select).toHaveBeenCalledOnce()
    expect(mocks.innerJoin).toHaveBeenCalledOnce()
  })

  it('genera un join que exige membresía en la misma organización del expediente', () => {
    const database = drizzle.mock()
    const query = buildAuthorizedExpedienteQuery(
      database,
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111'
    ).toSQL()

    expect(query.sql).toContain('from "expedientes"')
    expect(query.sql).toContain('inner join "organization_members"')
    expect(query.sql).toContain('"organization_members"."org_id" = "expedientes"."org_id"')
    expect(query.sql).toContain('"organization_members"."profile_id" = $1')
    expect(query.sql).toContain('where "expedientes"."id" = $2')
    expect(query.params).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      1,
    ])
  })
})
