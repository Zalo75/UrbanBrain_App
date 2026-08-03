import { describe, it, expect } from 'vitest'
import { DefaultPrecedenceEngineV2 } from './PrecedenceEngineV2'
import type { ApplicabilityEvaluationResult } from '@/domain/legal-engine/applicability'
import type { PlanningKnowledgeGraph, LegalRelationshipType } from '@/domain/planning-knowledge/pkbTypes'
import type { PrecedenceEvaluationRequest } from '@/domain/legal-engine/precedence'

// Mocks
const baseGraph: PlanningKnowledgeGraph = {
  municipalityCode: '15001',
  municipalityName: 'Test',
  version: 'v1',
  instruments: [],
  dispositions: [
    { id: 'd1', instrumentId: 'i1', type: 'ord', code: 'D1', name: 'D1' },
    { id: 'd2', instrumentId: 'i1', type: 'ord', code: 'D2', name: 'D2' },
    { id: 'd3', instrumentId: 'i1', type: 'ord', code: 'D3', name: 'D3' }
  ],
  relationships: []
}

const baseAppResult: ApplicabilityEvaluationResult = {
  status: 'evaluated',
  situationId: 'sit-1',
  municipalityCode: '15001',
  graphVersion: 'v1',
  decisions: [
    { dispositionId: 'd1', status: 'CANDIDATE', matchedFactIds: [], missingFactKinds: [], reasonCodes: [], evidenceIds: [] },
    { dispositionId: 'd2', status: 'CANDIDATE', matchedFactIds: [], missingFactKinds: [], reasonCodes: [], evidenceIds: [] },
    { dispositionId: 'd3', status: 'CANDIDATE', matchedFactIds: [], missingFactKinds: [], reasonCodes: [], evidenceIds: [] }
  ]
}

function createRequest(
  relationships: { id: string, source: string, target: string, type: LegalRelationshipType }[],
  appDecisions: { id: string, status: any }[] = [{id: 'd1', status: 'CANDIDATE'}, {id: 'd2', status: 'CANDIDATE'}, {id: 'd3', status: 'CANDIDATE'}]
): PrecedenceEvaluationRequest {
  const graph = JSON.parse(JSON.stringify(baseGraph))
  graph.relationships = relationships.map(r => ({
    id: r.id,
    source: { kind: 'disposition', id: r.source },
    target: { kind: 'disposition', id: r.target },
    type: r.type
  }))

  const applicabilityResult = JSON.parse(JSON.stringify(baseAppResult))
  applicabilityResult.decisions = appDecisions.map(d => ({
    dispositionId: d.id,
    status: d.status,
    matchedFactIds: [], missingFactKinds: [], reasonCodes: [], evidenceIds: []
  }))

  return { applicabilityResult, graph }
}

describe('PrecedenceEngineV2', () => {
  const engine = new DefaultPrecedenceEngineV2()

  it('1. Candidata sin relaciones -> EFFECTIVE', () => {
    const req = createRequest([])
    const res = engine.evaluate(req)
    
    expect(res.status).toBe('evaluated')
    if (res.status === 'evaluated') {
      expect(res.decisions.find(d => d.dispositionId === 'd1')?.status).toBe('EFFECTIVE')
      expect(res.decisions.find(d => d.dispositionId === 'd1')?.reasonCodes).toContain('NO_PRECEDENCE_EFFECT')
    }
  })

  it('2. REPLACES -> target DISPLACED', () => {
    const req = createRequest([{ id: 'r1', source: 'd1', target: 'd2', type: 'REPLACES' }])
    const res = engine.evaluate(req)
    if (res.status === 'evaluated') {
      expect(res.decisions.find(d => d.dispositionId === 'd2')?.status).toBe('DISPLACED')
      expect(res.decisions.find(d => d.dispositionId === 'd2')?.reasonCodes).toContain('DISPLACED_BY_REPLACEMENT')
    }
  })

  it('3. REPEALS -> target DISPLACED', () => {
    const req = createRequest([{ id: 'r1', source: 'd1', target: 'd2', type: 'REPEALS' }])
    const res = engine.evaluate(req)
    if (res.status === 'evaluated') {
      expect(res.decisions.find(d => d.dispositionId === 'd2')?.status).toBe('DISPLACED')
      expect(res.decisions.find(d => d.dispositionId === 'd2')?.reasonCodes).toContain('DISPLACED_BY_REPEAL')
    }
  })

  it('4. SUSPENDS -> target SUSPENDED', () => {
    const req = createRequest([{ id: 'r1', source: 'd1', target: 'd2', type: 'SUSPENDS' }])
    const res = engine.evaluate(req)
    if (res.status === 'evaluated') {
      expect(res.decisions.find(d => d.dispositionId === 'd2')?.status).toBe('SUSPENDED')
      expect(res.decisions.find(d => d.dispositionId === 'd2')?.reasonCodes).toContain('SUSPENDED_BY_RELATIONSHIP')
    }
  })

  it('5. RESTORES sin cadena estructurada -> REVIEW_REQUIRED', () => {
    const req = createRequest([{ id: 'r1', source: 'd1', target: 'd2', type: 'RESTORES' }])
    const res = engine.evaluate(req)
    if (res.status === 'evaluated') {
      expect(res.decisions.find(d => d.dispositionId === 'd2')?.status).toBe('REVIEW_REQUIRED')
      expect(res.decisions.find(d => d.dispositionId === 'd2')?.reasonCodes).toContain('RESTORATION_CHAIN_UNRESOLVED')
    }
  })

  it('6,7,8. COMPLEMENTS, DEVELOPS, REFERS_TO no altera', () => {
    const req = createRequest([
      { id: 'r1', source: 'd1', target: 'd2', type: 'COMPLEMENTS' },
      { id: 'r2', source: 'd1', target: 'd3', type: 'DEVELOPS' },
      { id: 'r3', source: 'd2', target: 'd3', type: 'REFERS_TO' }
    ])
    const res = engine.evaluate(req)
    if (res.status === 'evaluated') {
      expect(res.decisions.every(d => d.status === 'EFFECTIVE')).toBe(true)
    }
  })

  it('9,10. MODIFIES y PARTIALLY_REPEALS -> REVIEW_REQUIRED', () => {
    const req = createRequest([
      { id: 'r1', source: 'd1', target: 'd2', type: 'MODIFIES' },
      { id: 'r2', source: 'd1', target: 'd3', type: 'PARTIALLY_REPEALS' }
    ])
    const res = engine.evaluate(req)
    if (res.status === 'evaluated') {
      expect(res.decisions.find(d => d.dispositionId === 'd2')?.status).toBe('REVIEW_REQUIRED')
      expect(res.decisions.find(d => d.dispositionId === 'd2')?.reasonCodes).toContain('MODIFICATION_SCOPE_UNKNOWN')
      expect(res.decisions.find(d => d.dispositionId === 'd3')?.status).toBe('REVIEW_REQUIRED')
      expect(res.decisions.find(d => d.dispositionId === 'd3')?.reasonCodes).toContain('PARTIAL_REPEAL_SCOPE_UNKNOWN')
    }
  })

  it('11. Source no candidata no produce efecto', () => {
    const req = createRequest(
      [{ id: 'r1', source: 'd1', target: 'd2', type: 'REPEALS' }],
      [{ id: 'd1', status: 'EXCLUDED' }, { id: 'd2', status: 'CANDIDATE' }]
    )
    const res = engine.evaluate(req)
    if (res.status === 'evaluated') {
      expect(res.decisions.find(d => d.dispositionId === 'd2')?.status).toBe('EFFECTIVE')
    }
  })

  it('12. Target no candidata no aparece en salida', () => {
    const req = createRequest(
      [{ id: 'r1', source: 'd1', target: 'd2', type: 'REPEALS' }],
      [{ id: 'd1', status: 'CANDIDATE' }, { id: 'd2', status: 'EXCLUDED' }]
    )
    const res = engine.evaluate(req)
    if (res.status === 'evaluated') {
      expect(res.decisions.find(d => d.dispositionId === 'd2')).toBeUndefined()
      expect(res.decisions.length).toBe(1)
    }
  })

  it('13,14. Relación de instrumento a disposición (o al reves) no se ejecuta', () => {
    const req = createRequest([{ id: 'r1', source: 'd1', target: 'd2', type: 'REPEALS' }])
    req.graph.relationships[0].source.kind = 'instrument' // 13
    
    let res = engine.evaluate(req)
    if (res.status === 'evaluated') {
      expect(res.decisions.find(d => d.dispositionId === 'd2')?.status).toBe('EFFECTIVE')
    }
    
    req.graph.relationships[0].source.kind = 'disposition'
    req.graph.relationships[0].target.kind = 'instrument' // 14
    res = engine.evaluate(req)
    if (res.status === 'evaluated') {
      expect(res.decisions.find(d => d.dispositionId === 'd1')?.status).toBe('EFFECTIVE')
    }
  })

  it('15. Ciclo REPLACES', () => {
    const req = createRequest([
      { id: 'r1', source: 'd1', target: 'd2', type: 'REPLACES' },
      { id: 'r2', source: 'd2', target: 'd1', type: 'REPLACES' }
    ])
    const res = engine.evaluate(req)
    if (res.status === 'evaluated') {
      expect(res.decisions.find(d => d.dispositionId === 'd1')?.status).toBe('REVIEW_REQUIRED')
      expect(res.decisions.find(d => d.dispositionId === 'd1')?.reasonCodes).toContain('CYCLIC_RELATIONSHIP')
      expect(res.decisions.find(d => d.dispositionId === 'd2')?.status).toBe('REVIEW_REQUIRED')
    }
  })

  it('16. Ciclo REPEALS/SUSPENDS', () => {
    const req = createRequest([
      { id: 'r1', source: 'd1', target: 'd2', type: 'SUSPENDS' },
      { id: 'r2', source: 'd2', target: 'd1', type: 'REPEALS' }
    ])
    const res = engine.evaluate(req)
    if (res.status === 'evaluated') {
      expect(res.decisions.find(d => d.dispositionId === 'd1')?.status).toBe('REVIEW_REQUIRED')
      expect(res.decisions.find(d => d.dispositionId === 'd1')?.reasonCodes).toContain('CYCLIC_RELATIONSHIP')
    }
  })

  it('17. COMPLEMENTS cíclico no genera ciclo jurídico', () => {
    const req = createRequest([
      { id: 'r1', source: 'd1', target: 'd2', type: 'COMPLEMENTS' },
      { id: 'r2', source: 'd2', target: 'd1', type: 'COMPLEMENTS' }
    ])
    const res = engine.evaluate(req)
    if (res.status === 'evaluated') {
      expect(res.decisions.find(d => d.dispositionId === 'd1')?.status).toBe('EFFECTIVE')
      expect(res.decisions.find(d => d.dispositionId === 'd2')?.status).toBe('EFFECTIVE')
    }
  })

  it('18. REPEALS y SUSPENDS simultáneos -> REVIEW_REQUIRED', () => {
    const req = createRequest([
      { id: 'r1', source: 'd1', target: 'd3', type: 'REPEALS' },
      { id: 'r2', source: 'd2', target: 'd3', type: 'SUSPENDS' }
    ])
    const res = engine.evaluate(req)
    if (res.status === 'evaluated') {
      expect(res.decisions.find(d => d.dispositionId === 'd3')?.status).toBe('REVIEW_REQUIRED')
      expect(res.decisions.find(d => d.dispositionId === 'd3')?.reasonCodes).toContain('CONTRADICTORY_RELATIONSHIPS')
    }
  })

  it('19. IDs de relación aplicados trazables', () => {
    const req = createRequest([{ id: 'rel_xxx', source: 'd1', target: 'd2', type: 'REPEALS' }])
    const res = engine.evaluate(req)
    if (res.status === 'evaluated') {
      expect(res.decisions.find(d => d.dispositionId === 'd2')?.appliedRelationshipIds).toContain('rel_xxx')
    }
  })

  it('20. Decisión candidata inexistente en el grafo -> invalid_request', () => {
    const req = createRequest([])
    req.applicabilityResult = { ...req.applicabilityResult, status: 'evaluated' } as any
    if (req.applicabilityResult.status === 'evaluated') {
      req.applicabilityResult.decisions.push({
        dispositionId: 'ghost', status: 'CANDIDATE', matchedFactIds: [], missingFactKinds: [], reasonCodes: [], evidenceIds: []
      })
    }
    const res = engine.evaluate(req)
    expect(res.status).toBe('invalid_request')
    if (res.status === 'invalid_request') {
      expect(res.reasonCode).toBe('INVALID_PRECEDENCE_REQUEST')
    }
  })

  it('21. ApplicabilityResult no evaluated -> invalid_request', () => {
    const req = createRequest([])
    req.applicabilityResult = { status: 'invalid_request', reasonCode: 'INVALID_GRAPH_QUERY' }
    const res = engine.evaluate(req)
    expect(res.status).toBe('invalid_request')
  })

  it('22. Identidad del resultado y del grafo incoherente -> invalid_request', () => {
    const req = createRequest([])
    if (req.applicabilityResult.status === 'evaluated') {
      req.applicabilityResult.municipalityCode = '99999'
    }
    const res = engine.evaluate(req)
    expect(res.status).toBe('invalid_request')
  })

  it('23,24. Salida independiente del orden', () => {
    const req1 = createRequest([
      { id: 'r1', source: 'd1', target: 'd3', type: 'REPEALS' },
      { id: 'r2', source: 'd2', target: 'd3', type: 'SUSPENDS' }
    ])
    
    const req2 = createRequest([
      { id: 'r2', source: 'd2', target: 'd3', type: 'SUSPENDS' },
      { id: 'r1', source: 'd1', target: 'd3', type: 'REPEALS' }
    ], [{id: 'd3', status: 'CANDIDATE'}, {id: 'd2', status: 'CANDIDATE'}, {id: 'd1', status: 'CANDIDATE'}])

    const res1 = engine.evaluate(req1)
    const res2 = engine.evaluate(req2)
    
    expect(res1).toEqual(res2)
  })

  it('25,26,27. Salida serializable, sin mutación, json determinista', () => {
    const req = createRequest([{ id: 'r1', source: 'd1', target: 'd2', type: 'REPEALS' }])
    const reqClone = JSON.parse(JSON.stringify(req))
    
    const res1 = engine.evaluate(req)
    const res2 = engine.evaluate(reqClone)
    
    // No mutación
    expect(req).toEqual(reqClone)
    // Determinismo
    expect(JSON.stringify(res1)).toEqual(JSON.stringify(res2))
    // Serializable (JSON parse/stringify safe)
    expect(JSON.parse(JSON.stringify(res1))).toEqual(res1)
  })
})
