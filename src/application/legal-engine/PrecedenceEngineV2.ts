import type {
  PrecedenceEngineV2,
  PrecedenceEvaluationRequest,
  PrecedenceEvaluationResult,
  PrecedenceDecision,
  PrecedenceStatus,
  PrecedenceReasonCode
} from '@/domain/legal-engine/precedence'

export class DefaultPrecedenceEngineV2 implements PrecedenceEngineV2 {
  evaluate(request: PrecedenceEvaluationRequest): PrecedenceEvaluationResult {
    const { applicabilityResult, graph } = request

    if (applicabilityResult.status !== 'evaluated') {
      return { 
        status: 'invalid_request', 
        reasonCode: 'INVALID_PRECEDENCE_REQUEST', 
        situationId: applicabilityResult.status === 'graph_not_found' ? applicabilityResult.situationId : (applicabilityResult as any).situationId 
      }
    }
    
    if (!applicabilityResult.situationId) {
      return { status: 'invalid_request', reasonCode: 'INVALID_PRECEDENCE_REQUEST' }
    }
    
    if (applicabilityResult.municipalityCode !== graph.municipalityCode || applicabilityResult.graphVersion !== graph.version) {
      return { status: 'invalid_request', situationId: applicabilityResult.situationId, reasonCode: 'INVALID_PRECEDENCE_REQUEST' }
    }

    const candidateIds = new Set<string>()
    const decisionIds = new Set<string>()

    for (const dec of applicabilityResult.decisions) {
      if (decisionIds.has(dec.dispositionId)) {
        return { status: 'invalid_request', situationId: applicabilityResult.situationId, reasonCode: 'INVALID_PRECEDENCE_REQUEST' }
      }
      decisionIds.add(dec.dispositionId)
      
      const existsInGraph = graph.dispositions.some(d => d.id === dec.dispositionId)
      if (!existsInGraph) {
        return { status: 'invalid_request', situationId: applicabilityResult.situationId, reasonCode: 'INVALID_PRECEDENCE_REQUEST' }
      }

      if (dec.status === 'CANDIDATE') {
        candidateIds.add(dec.dispositionId)
      }
    }

    const precedenceAlteringTypes = ['REPLACES', 'REPEALS', 'SUSPENDS']
    const validRels = (graph.relationships || []).filter(r => 
      r.source.kind === 'disposition' && 
      r.target.kind === 'disposition' &&
      candidateIds.has(r.source.id) &&
      candidateIds.has(r.target.id)
    )

    const adj = new Map<string, string[]>()
    for (const r of validRels) {
      if (precedenceAlteringTypes.includes(r.type)) {
        const list = adj.get(r.source.id) || []
        list.push(r.target.id)
        adj.set(r.source.id, list)
      }
    }

    const visited = new Set<string>()
    const recStack = new Set<string>()
    const inCycle = new Set<string>()
    const path: string[] = []

    const detectCycles = (node: string) => {
      if (recStack.has(node)) {
        const cycleStartIndex = path.indexOf(node)
        if (cycleStartIndex !== -1) {
          for (let i = cycleStartIndex; i < path.length; i++) {
            inCycle.add(path[i])
          }
        }
        return
      }
      if (visited.has(node)) return
      
      visited.add(node)
      recStack.add(node)
      path.push(node)
      
      const neighbors = adj.get(node) || []
      for (const n of neighbors) {
        detectCycles(n)
      }
      
      path.pop()
      recStack.delete(node)
    }
    
    // Evaluate cycles with determinism regardless of input array order.
    // We sort candidateIds so graph traversal is completely deterministic.
    const sortedCandidates = Array.from(candidateIds).sort()
    for (const node of sortedCandidates) {
      if (!visited.has(node)) {
        detectCycles(node)
      }
    }
    
    const decisions: PrecedenceDecision[] = []
    
    for (const dispId of candidateIds) {
      if (inCycle.has(dispId)) {
        const appliedRels = validRels.filter(r => 
          (r.source.id === dispId || r.target.id === dispId) && 
          inCycle.has(r.source.id) && 
          inCycle.has(r.target.id) &&
          precedenceAlteringTypes.includes(r.type)
        ).map(r => r.id)
        
        decisions.push({
          dispositionId: dispId,
          status: 'REVIEW_REQUIRED',
          reasonCodes: ['CYCLIC_RELATIONSHIP'],
          appliedRelationshipIds: appliedRels.sort()
        })
        continue
      }
      
      const incoming = validRels.filter(r => r.target.id === dispId)
      
      let isDisplacedByRepeal = false
      let isDisplacedByReplacement = false
      let isSuspended = false
      let isReviewRequired = false
      
      const appliedRels = new Set<string>()
      const reasonCodes = new Set<PrecedenceReasonCode>()
      
      for (const r of incoming) {
        if (r.type === 'REPEALS') {
          isDisplacedByRepeal = true
          appliedRels.add(r.id)
        } else if (r.type === 'REPLACES') {
          isDisplacedByReplacement = true
          appliedRels.add(r.id)
        } else if (r.type === 'SUSPENDS') {
          isSuspended = true
          appliedRels.add(r.id)
        } else if (r.type === 'MODIFIES') {
          isReviewRequired = true
          reasonCodes.add('MODIFICATION_SCOPE_UNKNOWN')
          appliedRels.add(r.id)
        } else if (r.type === 'PARTIALLY_REPEALS') {
          isReviewRequired = true
          reasonCodes.add('PARTIAL_REPEAL_SCOPE_UNKNOWN')
          appliedRels.add(r.id)
        } else if (r.type === 'RESTORES') {
          isReviewRequired = true
          reasonCodes.add('RESTORATION_CHAIN_UNRESOLVED')
          appliedRels.add(r.id)
        }
      }
      
      const isDisplaced = isDisplacedByRepeal || isDisplacedByReplacement
      let hasConflict = false
      if (isDisplaced && isSuspended) hasConflict = true
      if (isDisplaced && isReviewRequired) hasConflict = true
      if (isSuspended && isReviewRequired) hasConflict = true
      
      let status: PrecedenceStatus = 'EFFECTIVE'
      
      if (hasConflict) {
        status = 'REVIEW_REQUIRED'
        reasonCodes.add('CONTRADICTORY_RELATIONSHIPS')
      } else if (isReviewRequired) {
        status = 'REVIEW_REQUIRED'
      } else if (isDisplaced) {
        status = 'DISPLACED'
        if (isDisplacedByRepeal) reasonCodes.add('DISPLACED_BY_REPEAL')
        if (isDisplacedByReplacement) reasonCodes.add('DISPLACED_BY_REPLACEMENT')
      } else if (isSuspended) {
        status = 'SUSPENDED'
        reasonCodes.add('SUSPENDED_BY_RELATIONSHIP')
      } else {
        status = 'EFFECTIVE'
        reasonCodes.add('NO_PRECEDENCE_EFFECT')
      }
      
      decisions.push({
        dispositionId: dispId,
        status,
        reasonCodes: Array.from(reasonCodes).sort(),
        appliedRelationshipIds: Array.from(appliedRels).sort()
      })
    }
    
    decisions.sort((a, b) => a.dispositionId.localeCompare(b.dispositionId))
    
    return {
      status: 'evaluated',
      situationId: applicabilityResult.situationId,
      municipalityCode: applicabilityResult.municipalityCode,
      graphVersion: applicabilityResult.graphVersion,
      decisions
    }
  }
}
