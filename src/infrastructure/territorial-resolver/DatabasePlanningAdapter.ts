import { and, eq } from 'drizzle-orm'

import type { PlanningApplicability, PlanningPort } from '@/domain/territorial-resolver/types'
import { db } from '@/infrastructure/db/client'
import { municipalPlanning } from '@/infrastructure/db/schema'
import { getActiveP1PlanningKnowledge } from '@/infrastructure/planning-knowledge/PlanningKnowledgeBase'

export function buildApplicablePlanningQuery(database: typeof db, municipalityCode: string) {
  return database
    .select({
      name: municipalPlanning.name,
      approvalDate: municipalPlanning.approvalDate,
      sourceSystem: municipalPlanning.sourceSystem,
      sourceUrl: municipalPlanning.sourceUrl,
    })
    .from(municipalPlanning)
    .where(
      and(
        eq(municipalPlanning.municipalityId, municipalityCode),
        eq(municipalPlanning.status, 'vigente')
      )
    )
    .limit(2)
}

export class DatabasePlanningAdapter implements PlanningPort {
  async findApplicablePlanning(location: {
    municipalityCode?: string
  }): Promise<PlanningApplicability> {
    const municipalityCode = location.municipalityCode
    if (!municipalityCode) {
      return {
        status: 'not_determined',
        evidence: [],
        warnings: [
          {
            code: 'municipality_code_missing',
            message: 'No existe código INE oficial para consultar el planeamiento.',
          },
        ],
      }
    }

    const knowledge = getActiveP1PlanningKnowledge(municipalityCode)
    if (knowledge) {
      return {
        status: 'determined',
        instrument: knowledge.instrument.name,
        approvalDate: knowledge.instrument.approvalDate,
        sourceUrl: knowledge.instrument.inventoryUrl,
        applicableInstruments: [
          {
            id: knowledge.instrument.officialId,
            name: knowledge.instrument.name,
            kind: 'general',
            status: 'current',
            approvalDate: knowledge.instrument.approvalDate,
            sourceUrl: knowledge.instrument.inventoryUrl,
          },
        ],
        canAnswerConcreteParameters: false,
        evidence: [
          {
            source: 'siotuga',
            sourceUrl: knowledge.instrument.inventoryUrl,
            retrievedAt: knowledge.activation.verifiedAt,
            method: `Planning Knowledge Base ${knowledge.knowledgeVersion}`,
            scope: 'planning_instrument',
          },
        ],
        warnings: [],
      }
    }

    const rows = await buildApplicablePlanningQuery(db, municipalityCode)

    const sourced = rows.filter((row) => row.sourceUrl)
    if (sourced.length !== 1) {
      return {
        status: 'not_determined',
        evidence: [],
        warnings: [
          {
            code: sourced.length > 1 ? 'planning_conflict' : 'planning_not_catalogued',
            message:
              sourced.length > 1
                ? 'Hay varios instrumentos catalogados y no se puede elegir uno automáticamente.'
                : 'No hay un instrumento vigente y trazable catalogado para este municipio.',
          },
        ],
      }
    }

    const planning = sourced[0]
    return {
      status: 'determined',
      instrument: planning.name,
      approvalDate: planning.approvalDate?.toISOString(),
      sourceUrl: planning.sourceUrl!,
      evidence: [
        {
          source: planning.sourceSystem === 'SIOTUGA' ? 'siotuga' : 'urbanbrain',
          sourceUrl: planning.sourceUrl!,
          retrievedAt: new Date().toISOString(),
          method: 'catálogo de planeamiento municipal',
          scope: 'planning_instrument',
        },
      ],
      warnings: [],
    }
  }
}
