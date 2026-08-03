import { describe, it, expect, beforeEach } from 'vitest'
import { DefaultApplicabilityEngineV2 } from './ApplicabilityEngineV2'
import { InMemoryPlanningKnowledgeGraphRepository } from '@/infrastructure/planning-knowledge/InMemoryPlanningKnowledgeGraphRepository'
import type { PlanningKnowledgeGraph } from '@/domain/planning-knowledge/pkbTypes'
import type { EvaluatedUrbanisticSituation, UrbanisticFact } from '@/domain/legal-engine/types'

describe('ApplicabilityEngineV2', () => {
  let repo: InMemoryPlanningKnowledgeGraphRepository
  let engine: DefaultApplicabilityEngineV2

  beforeEach(() => {
    repo = new InMemoryPlanningKnowledgeGraphRepository()
    engine = new DefaultApplicabilityEngineV2(repo)
  })

  const baseSituation: EvaluatedUrbanisticSituation = {
    id: 'sit-1',
    referenceDate: '2023-01-01',
    jurisdiction: { municipalityCode: '15001' },
    territorialScope: { id: 'scope-1', type: 'parcel' }
  }

  const createGraph = (code: string, version: string): PlanningKnowledgeGraph => ({
    municipalityCode: code,
    municipalityName: 'TestCity',
    version,
    instruments: [{ id: 'i1', name: 'Inst1', kind: 'general' }],
    dispositions: [],
    relationships: []
  })

  const baseFact = (id: string, property: any, value: any): UrbanisticFact => ({
    id,
    situationId: 'sit-1',
    property,
    value,
    createdAt: '2023-01-01'
  })

  const register = async (graph: PlanningKnowledgeGraph) => {
    const res = await repo.register(graph)
    if (res.status !== 'registered') throw new Error('Invalid graph: ' + JSON.stringify(res))
  }

  it('13. Grafo inexistente devuelve graph_not_found', async () => {
    const res = await engine.evaluate({
      situation: baseSituation,
      facts: [],
      graphIdentity: { municipalityCode: '15001', version: 'v1' }
    })
    expect(res.status).toBe('graph_not_found')
    if (res.status === 'graph_not_found') {
      expect(res.reasonCode).toBe('GRAPH_NOT_FOUND')
    }
  })

  it('14. Consulta inválida devuelve invalid_request', async () => {
    const res = await engine.evaluate({
      situation: baseSituation,
      facts: [],
      graphIdentity: { municipalityCode: '', version: 'v1' }
    })
    expect(res.status).toBe('invalid_request')
    if (res.status === 'invalid_request') {
      expect(res.reasonCode).toBe('INVALID_GRAPH_QUERY')
    }
  })

  it('28. Consulta con situación vacía o de otro municipio devuelve invalid_request', async () => {
    let res = await engine.evaluate({
      situation: { ...baseSituation, id: '' },
      facts: [],
      graphIdentity: { municipalityCode: '15001', version: 'v1' }
    })
    expect(res.status).toBe('invalid_request')

    res = await engine.evaluate({
      situation: { ...baseSituation, jurisdiction: { municipalityCode: '15009' } },
      facts: [],
      graphIdentity: { municipalityCode: '15001', version: 'v1' }
    })
    expect(res.status).toBe('invalid_request')
  })

  it('29. Error técnico del repositorio no se convierte en graph_not_found', async () => {
    // Inject a fault
    repo.getByIdentity = async () => { throw new Error('DB Error') }
    
    await expect(engine.evaluate({
      situation: baseSituation,
      facts: [],
      graphIdentity: { municipalityCode: '15001', version: 'v1' }
    })).rejects.toThrow('DB Error')
  })

  it('1. EQUALS satisfecho -> CANDIDATE', async () => {
    const graph = createGraph('15001', 'v1')
    graph.dispositions = [{
      id: 'disp-1', instrumentId: 'i1', type: 'ord', code: 'U1', name: 'U1',
      applicabilityConditions: [{ id: 'c1', factKind: 'classification', operator: 'EQUALS', expectedValue: 'urbano' }],
      evidenceIds: ['ev-1']
    }]
    graph.evidences = [{ id: 'ev-1', subjectId: 'disp-1', kind: 'document', createdAt: '2023-01-01' }]
    graph.evidenceLinks = [{ evidenceId: 'ev-1', subject: { kind: 'disposition', id: 'disp-1' } }]
    await register(graph)

    const facts = [baseFact('f1', 'classification', 'urbano')]
    const res = await engine.evaluate({ situation: baseSituation, facts, graphIdentity: { municipalityCode: '15001', version: 'v1' } })
    
    expect(res.status).toBe('evaluated')
    if (res.status === 'evaluated') {
      expect(res.decisions[0].status).toBe('CANDIDATE')
      expect(res.decisions[0].reasonCodes).toContain('CONDITIONS_MET')
      expect(res.decisions[0].matchedFactIds).toContain('f1')
      expect(res.decisions[0].evidenceIds).toContain('ev-1') // 17. evidenceIds procede de la disposición
    }
  })

  it('2. EQUALS incompatible -> EXCLUDED', async () => {
    const graph = createGraph('15001', 'v1')
    graph.dispositions = [{
      id: 'disp-1', instrumentId: 'i1', type: 'ord', code: 'U1', name: 'U1',
      applicabilityConditions: [{ id: 'c1', factKind: 'classification', operator: 'EQUALS', expectedValue: 'urbano' }]
    }]
    await register(graph)

    const facts = [baseFact('f1', 'classification', 'rustico')]
    const res = await engine.evaluate({ situation: baseSituation, facts, graphIdentity: { municipalityCode: '15001', version: 'v1' } })
    
    if (res.status === 'evaluated') {
      expect(res.decisions[0].status).toBe('EXCLUDED')
      expect(res.decisions[0].reasonCodes).toContain('FACT_MISMATCH')
    }
  })

  it('3. NOT_EQUALS', async () => {
    const graph = createGraph('15001', 'v1')
    graph.dispositions = [{
      id: 'disp-1', instrumentId: 'i1', type: 'ord', code: 'U1', name: 'U1',
      applicabilityConditions: [{ id: 'c1', factKind: 'classification', operator: 'NOT_EQUALS', expectedValue: 'rustico' }]
    }]
    await register(graph)

    const facts = [baseFact('f1', 'classification', 'urbano')]
    const res = await engine.evaluate({ situation: baseSituation, facts, graphIdentity: { municipalityCode: '15001', version: 'v1' } })
    
    if (res.status === 'evaluated') {
      expect(res.decisions[0].status).toBe('CANDIDATE')
    }
  })

  it('4. IN', async () => {
    const graph = createGraph('15001', 'v1')
    graph.dispositions = [{
      id: 'disp-1', instrumentId: 'i1', type: 'ord', code: 'U1', name: 'U1',
      applicabilityConditions: [{ id: 'c1', factKind: 'classification', operator: 'IN', expectedValues: ['urbano', 'urbanizable'] }]
    }]
    await register(graph)

    const facts = [baseFact('f1', 'classification', 'urbanizable')]
    const res = await engine.evaluate({ situation: baseSituation, facts, graphIdentity: { municipalityCode: '15001', version: 'v1' } })
    
    if (res.status === 'evaluated') {
      expect(res.decisions[0].status).toBe('CANDIDATE')
    }
  })

  it('5. NOT_IN', async () => {
    const graph = createGraph('15001', 'v1')
    graph.dispositions = [{
      id: 'disp-1', instrumentId: 'i1', type: 'ord', code: 'U1', name: 'U1',
      applicabilityConditions: [{ id: 'c1', factKind: 'classification', operator: 'NOT_IN', expectedValues: ['rustico', 'protegido'] }]
    }]
    await register(graph)

    const facts = [baseFact('f1', 'classification', 'rustico')]
    const res = await engine.evaluate({ situation: baseSituation, facts, graphIdentity: { municipalityCode: '15001', version: 'v1' } })
    
    if (res.status === 'evaluated') {
      expect(res.decisions[0].status).toBe('EXCLUDED')
    }
  })

  it('6. EXISTS', async () => {
    const graph = createGraph('15001', 'v1')
    graph.dispositions = [{
      id: 'disp-1', instrumentId: 'i1', type: 'ord', code: 'U1', name: 'U1',
      applicabilityConditions: [{ id: 'c1', factKind: 'affect', operator: 'EXISTS' }]
    }]
    await register(graph)

    const facts = [baseFact('f1', 'affect', 'costas')]
    const res = await engine.evaluate({ situation: baseSituation, facts, graphIdentity: { municipalityCode: '15001', version: 'v1' } })
    
    if (res.status === 'evaluated') {
      expect(res.decisions[0].status).toBe('CANDIDATE')
    }
  })

  it('7. NOT_EXISTS', async () => {
    const graph = createGraph('15001', 'v1')
    graph.dispositions = [{
      id: 'disp-1', instrumentId: 'i1', type: 'ord', code: 'U1', name: 'U1',
      applicabilityConditions: [{ id: 'c1', factKind: 'affect', operator: 'NOT_EXISTS' }]
    }]
    await register(graph)

    const facts = [baseFact('f1', 'affect', 'costas')]
    const res = await engine.evaluate({ situation: baseSituation, facts, graphIdentity: { municipalityCode: '15001', version: 'v1' } })
    
    if (res.status === 'evaluated') {
      expect(res.decisions[0].status).toBe('EXCLUDED')
    }
  })

  it('33. EXISTS y NOT_EXISTS toleran múltiples valores (conflicto) para el mismo kind', async () => {
    const graph = createGraph('15001', 'v1')
    graph.dispositions = [{
      id: 'disp-exists', instrumentId: 'i1', type: 'ord', code: 'E1', name: 'E1',
      applicabilityConditions: [{ id: 'c1', factKind: 'affect', operator: 'EXISTS' }]
    }, {
      id: 'disp-notexists', instrumentId: 'i1', type: 'ord', code: 'NE1', name: 'NE1',
      applicabilityConditions: [{ id: 'c2', factKind: 'affect', operator: 'NOT_EXISTS' }]
    }]
    await register(graph)

    const facts = [
      baseFact('f1', 'affect', 'costas'),
      baseFact('f2', 'affect', 'carreteras')
    ]
    const res = await engine.evaluate({ situation: baseSituation, facts, graphIdentity: { municipalityCode: '15001', version: 'v1' } })
    
    if (res.status === 'evaluated') {
      const decE = res.decisions.find(d => d.dispositionId === 'disp-exists')!
      const decNE = res.decisions.find(d => d.dispositionId === 'disp-notexists')!
      
      expect(decE.status).toBe('CANDIDATE')
      expect(decE.matchedFactIds).toEqual(['f1', 'f2']) // Ambos cumplen
      
      expect(decNE.status).toBe('EXCLUDED')
    }
  })

  it('8. Falta un hecho requerido -> INDETERMINATE', async () => {
    const graph = createGraph('15001', 'v1')
    graph.dispositions = [{
      id: 'disp-1', instrumentId: 'i1', type: 'ord', code: 'U1', name: 'U1',
      applicabilityConditions: [{ id: 'c1', factKind: 'classification', operator: 'EQUALS', expectedValue: 'urbano' }]
    }]
    await register(graph)

    const res = await engine.evaluate({ situation: baseSituation, facts: [], graphIdentity: { municipalityCode: '15001', version: 'v1' } })
    
    if (res.status === 'evaluated') {
      expect(res.decisions[0].status).toBe('INDETERMINATE')
      expect(res.decisions[0].reasonCodes).toContain('MISSING_REQUIRED_FACT')
      expect(res.decisions[0].missingFactKinds).toContain('classification') // 16. missingFactKinds tipado
    }
  })

  it('9. Hechos duplicados con mismo valor no generan conflicto y se agrupan deterministamente', async () => {
    const graph = createGraph('15001', 'v1')
    graph.dispositions = [{
      id: 'disp-1', instrumentId: 'i1', type: 'ord', code: 'U1', name: 'U1',
      applicabilityConditions: [{ id: 'c1', factKind: 'classification', operator: 'EQUALS', expectedValue: 'urbano' }]
    }]
    await register(graph)

    const facts = [
      baseFact('f2', 'classification', 'urbano'), // f2 first
      baseFact('f1', 'classification', 'urbano')  // f1 second
    ]
    const res = await engine.evaluate({ situation: baseSituation, facts, graphIdentity: { municipalityCode: '15001', version: 'v1' } })
    
    if (res.status === 'evaluated') {
      expect(res.decisions[0].status).toBe('CANDIDATE')
      // Ambos identificadores deben estar presentes y ordenados
      expect(res.decisions[0].matchedFactIds).toEqual(['f1', 'f2'])
    }
  })

  it('34. Agrupación segura sin colisión de índice textual', async () => {
    const graph = createGraph('15001', 'v1')
    graph.dispositions = [{
      id: 'disp-1', instrumentId: 'i1', type: 'ord', code: 'U1', name: 'U1',
      applicabilityConditions: [{ id: 'c1', factKind: 'test', operator: 'EQUALS', expectedValue: '1' }]
    }]
    await register(graph)

    const facts = [
      baseFact('f1', 'test', '1'), // string
      baseFact('f2', 'test', 1),   // number
      baseFact('f3', 'test', '1:2')// valor con dos puntos
    ]
    const res = await engine.evaluate({ situation: baseSituation, facts, graphIdentity: { municipalityCode: '15001', version: 'v1' } })
    
    if (res.status === 'evaluated') {
      expect(res.decisions[0].status).toBe('REVIEW_REQUIRED')
      expect(res.decisions[0].reasonCodes).toContain('CONFLICTING_FACTS')
    }
  })

  it('10. Hechos del mismo kind con valores distintos generan REVIEW_REQUIRED', async () => {
    const graph = createGraph('15001', 'v1')
    graph.dispositions = [{
      id: 'disp-1', instrumentId: 'i1', type: 'ord', code: 'U1', name: 'U1',
      applicabilityConditions: [{ id: 'c1', factKind: 'classification', operator: 'EQUALS', expectedValue: 'urbano' }]
    }]
    await register(graph)

    const facts = [
      baseFact('f1', 'classification', 'urbano'),
      baseFact('f2', 'classification', 'rustico')
    ]
    const res = await engine.evaluate({ situation: baseSituation, facts, graphIdentity: { municipalityCode: '15001', version: 'v1' } })
    
    if (res.status === 'evaluated') {
      expect(res.decisions[0].status).toBe('REVIEW_REQUIRED')
      expect(res.decisions[0].reasonCodes).toContain('CONFLICTING_FACTS')
    }
  })

  it('11. Varias condiciones se combinan mediante AND', async () => {
    const graph = createGraph('15001', 'v1')
    graph.dispositions = [{
      id: 'disp-1', instrumentId: 'i1', type: 'ord', code: 'U1', name: 'U1',
      applicabilityConditions: [
        { id: 'c1', factKind: 'classification', operator: 'EQUALS', expectedValue: 'urbano' },
        { id: 'c2', factKind: 'category', operator: 'EQUALS', expectedValue: 'consolidado' }
      ]
    }]
    await register(graph)

    const facts = [
      baseFact('f1', 'classification', 'urbano'),
      baseFact('f2', 'category', 'no_consolidado')
    ]
    const res = await engine.evaluate({ situation: baseSituation, facts, graphIdentity: { municipalityCode: '15001', version: 'v1' } })
    
    if (res.status === 'evaluated') {
      expect(res.decisions[0].status).toBe('EXCLUDED')
      expect(res.decisions[0].reasonCodes).toContain('FACT_MISMATCH')
    }
  })

  it('12. Disposición sin condiciones genera REVIEW_REQUIRED', async () => {
    const graph = createGraph('15001', 'v1')
    graph.dispositions = [{
      id: 'disp-1', instrumentId: 'i1', type: 'ord', code: 'U1', name: 'U1'
      // no applicabilityConditions
    }]
    await register(graph)

    const facts = [baseFact('f1', 'classification', 'urbano')]
    const res = await engine.evaluate({ situation: baseSituation, facts, graphIdentity: { municipalityCode: '15001', version: 'v1' } })
    
    if (res.status === 'evaluated') {
      expect(res.decisions[0].status).toBe('REVIEW_REQUIRED')
      expect(res.decisions[0].reasonCodes).toContain('NO_APPLICABILITY_CONDITIONS')
    }
  })

  it('18. El motor no muta hechos, situación ni grafo', async () => {
    const graph = createGraph('15001', 'v1')
    graph.dispositions = [{
      id: 'disp-1', instrumentId: 'i1', type: 'ord', code: 'U1', name: 'U1',
      applicabilityConditions: [{ id: 'c1', factKind: 'classification', operator: 'EQUALS', expectedValue: 'urbano' }]
    }]
    await register(graph)

    const facts = [baseFact('f1', 'classification', 'urbano')]
    const factCopy = structuredClone(facts)
    const sitCopy = structuredClone(baseSituation)

    await engine.evaluate({ situation: baseSituation, facts, graphIdentity: { municipalityCode: '15001', version: 'v1' } })

    expect(facts).toEqual(factCopy)
    expect(baseSituation).toEqual(sitCopy)
    
    const lookup = await repo.getByIdentity({ municipalityCode: '15001', version: 'v1' })
    if (lookup.status === 'found') {
      expect(lookup.value.dispositions[0].applicabilityConditions![0].expectedValue).toBe('urbano')
    }
  })

  it('19. Salida serializable && 20. Misma entrada produce la misma salida', async () => {
    const graph = createGraph('15001', 'v1')
    graph.dispositions = [{
      id: 'disp-1', instrumentId: 'i1', type: 'ord', code: 'U1', name: 'U1',
      applicabilityConditions: [{ id: 'c1', factKind: 'classification', operator: 'EQUALS', expectedValue: 'urbano' }]
    }]
    await register(graph)

    const facts = [baseFact('f1', 'classification', 'urbano')]
    const res1 = await engine.evaluate({ situation: baseSituation, facts, graphIdentity: { municipalityCode: '15001', version: 'v1' } })
    const res2 = await engine.evaluate({ situation: baseSituation, facts, graphIdentity: { municipalityCode: '15001', version: 'v1' } })

    expect(JSON.parse(JSON.stringify(res1))).toEqual(res1)
    expect(res1).toEqual(res2)
  })

  it('30. Aislamiento por situación: Hechos de otras situaciones no afectan la evaluación', async () => {
    const graph = createGraph('15001', 'v1')
    graph.dispositions = [{
      id: 'disp-1', instrumentId: 'i1', type: 'ord', code: 'U1', name: 'U1',
      applicabilityConditions: [{ id: 'c1', factKind: 'classification', operator: 'EQUALS', expectedValue: 'urbano' }]
    }]
    await register(graph)

    const facts = [
      baseFact('f1', 'classification', 'urbano'),
      baseFact('f2', 'classification', 'rustico')
    ]
    // Modify situationId of the incompatible fact
    facts[1].situationId = 'sit-2'

    // The motor should only see 'urbano', matching the condition and ignoring the conflict
    const res = await engine.evaluate({ situation: baseSituation, facts, graphIdentity: { municipalityCode: '15001', version: 'v1' } })
    
    if (res.status === 'evaluated') {
      expect(res.decisions[0].status).toBe('CANDIDATE')
      expect(res.decisions[0].matchedFactIds).toEqual(['f1']) // only matched facts from sit-1
    }
  })

  it('31. Orden de condiciones y disposiciones no altera el resultado final (salvo la lista normalizada)', async () => {
    const conds = [
      { id: 'c1', factKind: 'classification', operator: 'EQUALS', expectedValue: 'urbano' as any },
      { id: 'c2', factKind: 'category', operator: 'NOT_EXISTS' as any }
    ]
    
    const disp1 = {
      id: 'disp-1', instrumentId: 'i1', type: 'ord', code: 'U1', name: 'U1',
      applicabilityConditions: [conds[0], conds[1]]
    }
    const disp2 = {
      id: 'disp-2', instrumentId: 'i1', type: 'ord', code: 'U2', name: 'U2',
      applicabilityConditions: [conds[1], conds[0]] // Reversed conditions
    }

    const graph1 = createGraph('15001', 'v1')
    graph1.dispositions = [disp1, disp2] // Order 1, 2
    
    const repo1 = new InMemoryPlanningKnowledgeGraphRepository()
    await repo1.register(graph1)
    const engine1 = new DefaultApplicabilityEngineV2(repo1)
    
    const facts = [baseFact('f1', 'classification', 'urbano'), baseFact('f2', 'category', 'consolidado')]
    const res1 = await engine1.evaluate({ situation: baseSituation, facts, graphIdentity: { municipalityCode: '15001', version: 'v1' } })

    const graph2 = createGraph('15001', 'v1')
    graph2.dispositions = [disp2, disp1] // Reversed dispositions
    
    const repo2 = new InMemoryPlanningKnowledgeGraphRepository()
    await repo2.register(graph2)
    const engine2 = new DefaultApplicabilityEngineV2(repo2)
    
    const res2 = await engine2.evaluate({ situation: baseSituation, facts, graphIdentity: { municipalityCode: '15001', version: 'v1' } })
    
    expect(res1).toEqual(res2)
    
    if (res1.status === 'evaluated') {
      // Must be sorted by dispositionId
      expect(res1.decisions[0].dispositionId).toBe('disp-1')
      expect(res1.decisions[1].dispositionId).toBe('disp-2')
    }
  })

  it('35. Normalización de evidenceIds (deduplicar y ordenar)', async () => {
    const graph = createGraph('15001', 'v1')
    graph.dispositions = [{
      id: 'disp-1', instrumentId: 'i1', type: 'ord', code: 'U1', name: 'U1',
      applicabilityConditions: [{ id: 'c1', factKind: 'classification', operator: 'EQUALS', expectedValue: 'urbano' }],
      evidenceIds: ['ev-2', 'ev-1', 'ev-2'] // duplicates and unordered
    }]
    graph.evidences = [
      { id: 'ev-1', subjectId: 'disp-1', kind: 'document', createdAt: '2023-01-01' },
      { id: 'ev-2', subjectId: 'disp-1', kind: 'document', createdAt: '2023-01-01' }
    ]
    graph.evidenceLinks = [
      { evidenceId: 'ev-1', subject: { kind: 'disposition', id: 'disp-1' } },
      { evidenceId: 'ev-2', subject: { kind: 'disposition', id: 'disp-1' } }
    ]
    await register(graph)

    const facts = [baseFact('f1', 'classification', 'urbano')]
    const res = await engine.evaluate({ situation: baseSituation, facts, graphIdentity: { municipalityCode: '15001', version: 'v1' } })
    
    if (res.status === 'evaluated') {
      expect(res.decisions[0].evidenceIds).toEqual(['ev-1', 'ev-2'])
    }
  })

  it('32. Immutabilidad de salida: Modificar la respuesta no altera evaluaciones futuras', async () => {
    const graph = createGraph('15001', 'v1')
    graph.dispositions = [{
      id: 'disp-1', instrumentId: 'i1', type: 'ord', code: 'U1', name: 'U1',
      applicabilityConditions: [{ id: 'c1', factKind: 'classification', operator: 'EQUALS', expectedValue: 'urbano' }],
      evidenceIds: ['ev-1']
    }]
    graph.evidences = [{ id: 'ev-1', subjectId: 'disp-1', kind: 'document', createdAt: '2023-01-01' }]
    graph.evidenceLinks = [{ evidenceId: 'ev-1', subject: { kind: 'disposition', id: 'disp-1' } }]
    await register(graph)

    const facts = [baseFact('f1', 'classification', 'urbano')]
    const res1 = await engine.evaluate({ situation: baseSituation, facts, graphIdentity: { municipalityCode: '15001', version: 'v1' } })
    
    if (res1.status === 'evaluated') {
      // Mutate the returned arrays
      res1.decisions[0].matchedFactIds.push('HACK')
      res1.decisions[0].evidenceIds.push('HACK')
      res1.decisions[0].reasonCodes.push('CONFLICTING_FACTS')
    }

    const res2 = await engine.evaluate({ situation: baseSituation, facts, graphIdentity: { municipalityCode: '15001', version: 'v1' } })
    
    if (res2.status === 'evaluated') {
      expect(res2.decisions[0].matchedFactIds).not.toContain('HACK')
      expect(res2.decisions[0].evidenceIds).not.toContain('HACK')
      expect(res2.decisions[0].reasonCodes).not.toContain('CONFLICTING_FACTS')
    }
  })

})
