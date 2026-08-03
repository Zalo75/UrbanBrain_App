import type { PlanningKnowledgeGraph } from '@/domain/planning-knowledge/pkbTypes'
import type { PlanningKnowledgeValidationError } from '@/domain/planning-knowledge/pkbTypes'

export type GraphRegistrationResult =
  | { status: 'registered'; value: PlanningKnowledgeGraph }
  | { status: 'duplicate'; existing: PlanningKnowledgeGraph }
  | { status: 'invalid'; errors: PlanningKnowledgeValidationError[] }

export type GraphLookupResult =
  | { status: 'found'; value: PlanningKnowledgeGraph }
  | { status: 'not_found' }
  | { status: 'ambiguous'; candidates: PlanningKnowledgeGraph[] }
  | { status: 'invalid_query'; errors: PlanningKnowledgeValidationError[] }

export interface PlanningKnowledgeGraphRepository {
  register(
    graph: PlanningKnowledgeGraph
  ): Promise<GraphRegistrationResult>

  getByIdentity(params: {
    municipalityCode: string
    version: string
  }): Promise<GraphLookupResult>

  getByMunicipality(
    municipalityCode: string
  ): Promise<GraphLookupResult>

  list(
    municipalityCode?: string
  ): Promise<PlanningKnowledgeGraph[]>
}
