import type { PlanningKnowledgeGraph } from '@/domain/planning-knowledge/pkbTypes'
import type {
  PlanningKnowledgeGraphRepository,
  GraphRegistrationResult,
  GraphLookupResult
} from '@/application/planning-knowledge/PlanningKnowledgeGraphRepository'
import { validatePlanningKnowledgeGraph } from '@/domain/planning-knowledge/validatePlanningKnowledgeBase'

export class InMemoryPlanningKnowledgeGraphRepository implements PlanningKnowledgeGraphRepository {
  private graphs: PlanningKnowledgeGraph[] = []

  async register(graph: PlanningKnowledgeGraph): Promise<GraphRegistrationResult> {
    const errors = validatePlanningKnowledgeGraph(graph)
    if (errors.length > 0) {
      return { status: 'invalid', errors }
    }

    const existingIndex = this.graphs.findIndex(
      g => g.municipalityCode === graph.municipalityCode && g.version === graph.version
    )

    if (existingIndex !== -1) {
      return { 
        status: 'duplicate', 
        existing: structuredClone(this.graphs[existingIndex])
      }
    }
    const safeCopy = structuredClone(graph)

    this.graphs.push(safeCopy)
    return { status: 'registered', value: structuredClone(safeCopy) }
  }

  async getByIdentity(params: { municipalityCode: string; version: string }): Promise<GraphLookupResult> {
    if (!params.municipalityCode || params.municipalityCode.trim() === '') {
      return { status: 'invalid_query', errors: [{ code: 'EMPTY_MUNICIPALITY_CODE', path: 'municipalityCode', message: 'Municipality code is required' }] }
    }
    if (!params.version || params.version.trim() === '') {
      return { status: 'invalid_query', errors: [{ code: 'EMPTY_GRAPH_VERSION', path: 'version', message: 'Version is required' }] }
    }

    const found = this.graphs.find(
      g => g.municipalityCode === params.municipalityCode && g.version === params.version
    )
    if (!found) {
      return { status: 'not_found' }
    }
    return { status: 'found', value: structuredClone(found) }
  }

  async getByMunicipality(municipalityCode: string): Promise<GraphLookupResult> {
    if (!municipalityCode || municipalityCode.trim() === '') {
      return { status: 'invalid_query', errors: [{ code: 'EMPTY_MUNICIPALITY_CODE', path: 'municipalityCode', message: 'Municipality code is required' }] }
    }

    const candidates = this.graphs.filter(g => g.municipalityCode === municipalityCode)
    
    if (candidates.length === 0) {
      return { status: 'not_found' }
    }
    
    if (candidates.length > 1) {
      return { status: 'ambiguous', candidates: candidates.map(c => structuredClone(c)) }
    }
    
    return { status: 'found', value: structuredClone(candidates[0]) }
  }

  async list(municipalityCode?: string): Promise<PlanningKnowledgeGraph[]> {
    let result = this.graphs
    if (municipalityCode) {
      result = result.filter(g => g.municipalityCode === municipalityCode)
    }
    return result.map(g => structuredClone(g))
  }
}
