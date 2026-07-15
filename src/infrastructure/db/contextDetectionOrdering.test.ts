import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import { latestContextDetectionOrder } from './contextDetectionOrdering'

describe('latestContextDetectionOrder', () => {
  it('prioriza el inicio logico del intento y no el orden de llegada de la respuesta', () => {
    const dialect = new PgDialect()
    const queries = latestContextDetectionOrder().map((expression) =>
      dialect.sqlToQuery(expression).sql.replace(/\s+/g, ' ')
    )

    expect(queries[0]).toContain("'latestAttemptAt'")
    expect(queries[0]).toContain("'attemptStartedAt'")
    expect(queries[0]).toContain('"detected_at"::text')
    expect(queries[0]).toContain('::timestamptz desc')
    expect(queries[1]).toContain('"detected_at" desc')
  })
})
