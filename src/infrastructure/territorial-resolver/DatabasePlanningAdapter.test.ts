import { describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import { getActiveP1PlanningMunicipalities } from '@/infrastructure/planning-knowledge/PlanningKnowledgeBase'

vi.mock('@/infrastructure/db/client', () => ({ db: {} }))

import { buildApplicablePlanningQuery, DatabasePlanningAdapter } from './DatabasePlanningAdapter'

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

  it.each(getActiveP1PlanningMunicipalities())(
    'resolves the P1 instrument $municipalityCode from the PKB without querying the database',
    async (knowledge) => {
      const result = await new DatabasePlanningAdapter().findApplicablePlanning({
        municipalityCode: knowledge.municipalityCode,
      })

      expect(result).toMatchObject({
        status: 'determined',
        instrument: knowledge.instrument.name,
        approvalDate: knowledge.instrument.approvalDate,
        canAnswerConcreteParameters: knowledge.coverage.normativeDocument,
        applicableInstruments: [{ id: knowledge.instrument.officialId, status: 'current' }],
      })
      expect(result.evidence[0]?.method).toContain('Planning Knowledge Base')
    }
  )
})
