import type { 
  ApplicabilityEngineV2, 
  ApplicabilityEvaluationRequest, 
  ApplicabilityEvaluationResult, 
  ApplicabilityDecision,
  ApplicabilityReasonCode,
  ApplicabilityStatus
} from '@/domain/legal-engine/applicability'
import type { PlanningKnowledgeGraphRepository } from '@/application/planning-knowledge/PlanningKnowledgeGraphRepository'
import type { FactCondition } from '@/domain/planning-knowledge/pkbTypes'
import type { UrbanisticFact, UrbanisticFactValue, UrbanisticFactKind } from '@/domain/legal-engine/types'

export class DefaultApplicabilityEngineV2 implements ApplicabilityEngineV2 {
  constructor(private readonly graphRepo: PlanningKnowledgeGraphRepository) {}

  async evaluate(request: ApplicabilityEvaluationRequest): Promise<ApplicabilityEvaluationResult> {
    if (!request.situation || !request.situation.id || request.situation.id.trim() === '') {
      return { status: 'invalid_request', reasonCode: 'INVALID_GRAPH_QUERY' }
    }
    if (!request.graphIdentity || !request.graphIdentity.municipalityCode || request.graphIdentity.municipalityCode.trim() === '') {
      return { status: 'invalid_request', situationId: request.situation.id, reasonCode: 'INVALID_GRAPH_QUERY' }
    }
    if (!request.graphIdentity.version || request.graphIdentity.version.trim() === '') {
      return { status: 'invalid_request', situationId: request.situation.id, reasonCode: 'INVALID_GRAPH_QUERY' }
    }
    if (request.situation.jurisdiction.municipalityCode !== request.graphIdentity.municipalityCode) {
      return { status: 'invalid_request', situationId: request.situation.id, reasonCode: 'INVALID_GRAPH_QUERY' }
    }

    const lookup = await this.graphRepo.getByIdentity(request.graphIdentity)
    
    if (lookup.status === 'invalid_query' || lookup.status === 'ambiguous') {
      return {
        status: 'invalid_request',
        situationId: request.situation.id,
        reasonCode: 'INVALID_GRAPH_QUERY'
      }
    }
    
    if (lookup.status === 'not_found') {
      return {
        status: 'graph_not_found',
        situationId: request.situation.id,
        municipalityCode: request.graphIdentity.municipalityCode,
        graphVersion: request.graphIdentity.version,
        reasonCode: 'GRAPH_NOT_FOUND'
      }
    }

    const graph = lookup.value
    
    // Group facts by kind -> value -> array of fact IDs
    const factsByKindAndValue = new Map<string, Map<UrbanisticFactValue, string[]>>()
    
    for (const fact of request.facts) {
      if (fact.situationId !== request.situation.id) continue
      
      let kindMap = factsByKindAndValue.get(fact.property)
      if (!kindMap) {
        kindMap = new Map<UrbanisticFactValue, string[]>()
        factsByKindAndValue.set(fact.property, kindMap)
      }
      let factIds = kindMap.get(fact.value)
      if (!factIds) {
        factIds = []
        kindMap.set(fact.value, factIds)
      }
      factIds.push(fact.id)
    }

    const conflictingKinds = new Set<string>()
    for (const [kind, valueMap] of factsByKindAndValue.entries()) {
      if (valueMap.size > 1) {
        conflictingKinds.add(kind)
      }
    }

    const decisions: ApplicabilityDecision[] = []

    for (const disp of graph.dispositions) {
      if (!disp.applicabilityConditions || disp.applicabilityConditions.length === 0) {
        decisions.push({
          dispositionId: disp.id,
          status: 'REVIEW_REQUIRED',
          matchedFactIds: [],
          missingFactKinds: [],
          reasonCodes: ['NO_APPLICABILITY_CONDITIONS'],
          evidenceIds: disp.evidenceIds ? [...disp.evidenceIds] : []
        })
        continue
      }

      let hasConflict = false
      let hasMismatch = false
      let hasMissing = false
      
      const matchedFactIds = new Set<string>()
      const missingFactKinds = new Set<UrbanisticFactKind>()
      const reasonCodes = new Set<ApplicabilityReasonCode>()

      for (const cond of disp.applicabilityConditions) {
        const kindMap = factsByKindAndValue.get(cond.factKind)

        if (cond.operator === 'EXISTS') {
          if (kindMap && kindMap.size > 0) {
            for (const ids of kindMap.values()) {
              for (const id of ids) matchedFactIds.add(id)
            }
          } else {
            hasMissing = true
            missingFactKinds.add(cond.factKind)
            reasonCodes.add('MISSING_REQUIRED_FACT')
          }
          continue
        }

        if (cond.operator === 'NOT_EXISTS') {
          if (kindMap && kindMap.size > 0) {
            hasMismatch = true
            reasonCodes.add('FACT_MISMATCH')
          }
          continue
        }

        if (conflictingKinds.has(cond.factKind)) {
          hasConflict = true
          reasonCodes.add('CONFLICTING_FACTS')
          continue
        }

        if (!kindMap || kindMap.size === 0) {
          hasMissing = true
          missingFactKinds.add(cond.factKind)
          reasonCodes.add('MISSING_REQUIRED_FACT')
          continue
        }

        const factValue = Array.from(kindMap.keys())[0]
        const factIds = kindMap.get(factValue)!

        let conditionMet = false
        switch (cond.operator) {
          case 'EQUALS': conditionMet = factValue === cond.expectedValue; break
          case 'NOT_EQUALS': conditionMet = factValue !== cond.expectedValue; break
          case 'IN': conditionMet = (cond.expectedValues || []).includes(factValue); break
          case 'NOT_IN': conditionMet = !(cond.expectedValues || []).includes(factValue); break
        }

        if (conditionMet) {
          for (const id of factIds) matchedFactIds.add(id)
        } else {
          hasMismatch = true
          reasonCodes.add('FACT_MISMATCH')
        }
      }

      let finalStatus: ApplicabilityStatus
      if (hasConflict) {
        finalStatus = 'REVIEW_REQUIRED'
      } else if (hasMismatch) {
        finalStatus = 'EXCLUDED'
      } else if (hasMissing) {
        finalStatus = 'INDETERMINATE'
      } else {
        finalStatus = 'CANDIDATE'
        reasonCodes.add('CONDITIONS_MET')
      }

      const uniqueEvidenceIds = new Set(disp.evidenceIds || [])
      
      decisions.push({
        dispositionId: disp.id,
        status: finalStatus,
        matchedFactIds: Array.from(matchedFactIds).sort(),
        missingFactKinds: Array.from(missingFactKinds).sort(),
        reasonCodes: Array.from(reasonCodes).sort(),
        evidenceIds: Array.from(uniqueEvidenceIds).sort()
      })
    }

    decisions.sort((a, b) => a.dispositionId.localeCompare(b.dispositionId))

    return {
      status: 'evaluated',
      situationId: request.situation.id,
      municipalityCode: request.graphIdentity.municipalityCode,
      graphVersion: request.graphIdentity.version,
      decisions
    }
  }
}
