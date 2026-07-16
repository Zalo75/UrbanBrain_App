import { describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'

vi.mock('@/infrastructure/db/client', () => ({ db: {} }))

import { buildApplicablePlanningQuery } from './DatabasePlanningAdapter'

describe('buildApplicablePlanningQuery', () => {
  it('consulta por código INE y limita el resultado a instrumentos vigentes', () => {
    const database = drizzle.mock()
    const query = buildApplicablePlanningQuery(database, '15030').toSQL()

    expect(query.sql).toContain('from "municipal_planning"')
    expect(query.sql).toContain('"municipal_planning"."municipality_id" = $1')
    expect(query.sql).toContain('"municipal_planning"."status" = $2')
    expect(query.sql).toContain('limit $3')
    expect(query.params).toEqual(['15030', 'vigente', 2])
  })
})
