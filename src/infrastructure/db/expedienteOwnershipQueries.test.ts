import { describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'

import {
  buildOwnedExpedientesListQuery,
  buildOwnedRecentExpedientesQuery,
} from './expedienteOwnershipQueries'

describe('owned expediente list queries', () => {
  it('lists only active expedientes whose owner is the authenticated user', () => {
    const query = buildOwnedExpedientesListQuery(
      drizzle.mock(),
      '11111111-1111-4111-8111-111111111111'
    ).toSQL()

    expect(query.sql).toContain('"expedientes"."owner_id" = $2')
    expect(query.sql).toContain('"expedientes"."status" <> $3')
    expect(query.params).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111111',
      'archived',
    ])
  })

  it('cannot include another owner in the dashboard query', () => {
    const query = buildOwnedRecentExpedientesQuery(
      drizzle.mock(),
      '22222222-2222-4222-8222-222222222222'
    ).toSQL()

    expect(query.sql).toContain('where "expedientes"."owner_id" = $1')
    expect(query.params).toEqual(['22222222-2222-4222-8222-222222222222', 5])
  })
})
