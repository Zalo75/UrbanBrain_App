import { describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import { getActiveP1PlanningMunicipalities } from '@/infrastructure/planning-knowledge/PlanningKnowledgeBase'

vi.mock('@/infrastructure/db/client', () => ({ db: {} }))

import {
  buildApplicablePlanningQuery,
  buildDynamicBasePlanningResult,
  DatabasePlanningAdapter,
  selectDynamicGeneralInstrument,
  selectUniquePilotGeneralInstrument,
} from './DatabasePlanningAdapter'

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

describe('selectDynamicGeneralInstrument', () => {
  it('reuses the official general instrument matching the municipal planning date', () => {
    const selected = selectDynamicGeneralInstrument([
      {
        officialId: '28558',
        kind: 'general_modification',
        name: 'Modificación',
        figure: 'Modificación',
        approvalDate: '2023-04-26',
        sourceId: 'inventory',
      },
      {
        officialId: '22210',
        kind: 'general',
        name: 'PXOM',
        figure: 'PXOM',
        approvalDate: '2008-10-06',
        sourceId: 'inventory',
      },
    ], new Date('2008-10-06T00:00:00.000Z'))

    expect(selected?.officialId).toBe('22210')
  })

  it('does not promote a modification when no general instrument matches', () => {
    const selected = selectDynamicGeneralInstrument([
      {
        officialId: '28558',
        kind: 'general_modification',
        name: 'Modificación',
        figure: 'Modificación',
        approvalDate: '2023-04-26',
        sourceId: 'inventory',
      },
      {
        officialId: '22210',
        kind: 'general',
        name: 'PXOM',
        figure: 'PXOM',
        approvalDate: '2008-10-06',
        sourceId: 'inventory',
      },
    ], '1990-01-01')

    expect(selected?.officialId).toBe('22210')
  })
})

describe('selectUniquePilotGeneralInstrument', () => {
  const general = (officialId: string, kind: 'general' | 'general_modification' = 'general') => ({
    officialId,
    kind,
    name: officialId,
    figure: kind,
    sourceId: 'inventory',
  })

  it('allows discovery without a municipal_planning row when exactly one general exists', () => {
    expect(selectUniquePilotGeneralInstrument([general('23045')])?.officialId).toBe('23045')
  })

  it('returns no selection when two general instruments are compatible', () => {
    expect(selectUniquePilotGeneralInstrument([general('23045'), general('23046')])).toBeUndefined()
  })

  it('does not promote a modification as a general instrument', () => {
    expect(selectUniquePilotGeneralInstrument([general('23046', 'general_modification')])).toBeUndefined()
  })

  it('builds the municipal base from a unique official general instrument', () => {
    const result = buildDynamicBasePlanningResult('36059', {
      inventory: [
        {
          officialId: '23045',
          kind: 'general',
          name: 'NORMAS SUBSIDIARIAS DE PLANEAMENTO',
          figure: 'NSP',
          approvalDate: '1993-02-12',
          sourceId: 'siotuga:36059',
        },
        {
          officialId: '27667',
          kind: 'general_modification',
          name: 'Modificación de las NSP',
          figure: 'Modificación',
          sourceId: 'siotuga:36059',
        },
      ],
      normativeDocuments: [
        {
          id: 'doc-23045-1',
          officialDocumentId: '23045-normativa',
          instrumentId: '23045',
          name: 'Normativa NSP',
          officialUrl: 'https://siotuga.example/23045.pdf',
          documentType: 'normative_text',
          corpusDocumentNames: [],
          validationStatus: 'discovered',
          sourceIds: ['siotuga:36059'],
        },
        {
          id: 'doc-27667-1',
          officialDocumentId: '27667-mod',
          instrumentId: '27667',
          name: 'Modificación',
          officialUrl: 'https://siotuga.example/27667.pdf',
          documentType: 'normative_text',
          corpusDocumentNames: [],
          validationStatus: 'discovered',
          sourceIds: ['siotuga:36059'],
        },
      ],
    })

    expect(result).toMatchObject({
      status: 'determined',
      instrument: 'NORMAS SUBSIDIARIAS DE PLANEAMENTO',
      applicableInstruments: [{ id: '23045', kind: 'general' }],
      documents: [{ instrumentId: '23045', id: '23045-normativa' }],
    })
    expect(result.documents).toHaveLength(1)
    expect(result.evidence[0]?.method).toContain('instrumento matriz 23045')
  })

  it('keeps planning undetermined when the official inventory has multiple generals', () => {
    const result = buildDynamicBasePlanningResult('99999', {
      inventory: [general('23045'), general('23046')],
      normativeDocuments: [{
        id: 'doc',
        officialDocumentId: 'doc',
        instrumentId: '23045',
        name: 'Normativa',
        officialUrl: 'https://siotuga.example/doc.pdf',
        documentType: 'normative_text',
        corpusDocumentNames: [],
        validationStatus: 'discovered',
        sourceIds: ['siotuga:99999'],
      }],
    })

    expect(result.status).toBe('not_determined')
    expect(result.warnings[0]?.code).toBe('planning_dynamic_base_ambiguous')
  })
})
