import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryPlanningKnowledgeGraphRepository } from '@/infrastructure/planning-knowledge/InMemoryPlanningKnowledgeGraphRepository'
import type { PlanningKnowledgeGraph } from '@/domain/planning-knowledge/pkbTypes'

describe('InMemoryPlanningKnowledgeGraphRepository', () => {
  let repo: InMemoryPlanningKnowledgeGraphRepository

  beforeEach(() => {
    repo = new InMemoryPlanningKnowledgeGraphRepository()
  })

  const createValidGraph = (code: string, version: string): PlanningKnowledgeGraph => ({
    municipalityCode: code,
    municipalityName: 'TestCity',
    version,
    instruments: [],
    dispositions: [],
    relationships: [],
    evidences: [{ id: 'ev-1', subjectId: 'inst-1', kind: 'document', createdAt: '2023-01-01' }],
    evidenceLinks: [{ evidenceId: 'ev-1', subject: { kind: 'instrument', id: 'inst-1' } }]
  })

  it('1. Registrar un grafo válido', async () => {
    const graph = createValidGraph('15001', 'v1')
    graph.instruments = [{ id: 'inst-1', name: 'Inst', kind: 'general', evidenceIds: ['ev-1'] }]
    const res = await repo.register(graph)
    expect(res.status).toBe('registered')
    if (res.status === 'registered') {
      expect(res.value.version).toBe('v1')
    }
  })

  it('2. Rechazar un grafo inválido', async () => {
    const graph = createValidGraph('15001', 'v1')
    graph.instruments = [
      { id: 'inst-1', name: 'Inst', kind: 'general' },
      { id: 'inst-1', name: 'Inst2', kind: 'general' }
    ] // duplicate instrument id
    const res = await repo.register(graph)
    expect(res.status).toBe('invalid')
  })

  it('3. Rechazar identidad duplicada', async () => {
    const graph1 = createValidGraph('15001', 'v1')
    graph1.instruments = [{ id: 'inst-1', name: 'Inst', kind: 'general', evidenceIds: ['ev-1'] }]
    await repo.register(graph1)
    
    const graph2 = createValidGraph('15001', 'v1') // Same municipality and version
    graph2.instruments = [{ id: 'inst-2', name: 'Inst2', kind: 'general' }]
    graph2.evidences = []
    graph2.evidenceLinks = []
    const res = await repo.register(graph2)
    
    expect(res.status).toBe('duplicate')
    if (res.status === 'duplicate') {
      expect(res.existing.instruments[0].id).toBe('inst-1')
    }
  })

  it('4. Recuperar por municipalityCode + version', async () => {
    const graph = createValidGraph('15001', 'v1')
    graph.instruments = [{ id: 'inst-1', name: 'Inst', kind: 'general', evidenceIds: ['ev-1'] }]
    await repo.register(graph)
    
    const res = await repo.getByIdentity({ municipalityCode: '15001', version: 'v1' })
    expect(res.status).toBe('found')
    if (res.status === 'found') {
      expect(res.value.version).toBe('v1')
    }
  })

  it('5. Municipio inexistente', async () => {
    const res = await repo.getByMunicipality('99999')
    expect(res.status).toBe('not_found')
  })

  it('6. Consulta por municipio con una versión -> found', async () => {
    const graph = createValidGraph('15001', 'v1')
    graph.instruments = [{ id: 'inst-1', name: 'Inst', kind: 'general', evidenceIds: ['ev-1'] }]
    await repo.register(graph)
    
    const res = await repo.getByMunicipality('15001')
    expect(res.status).toBe('found')
  })

  it('7. Consulta por municipio con varias versiones -> ambiguous', async () => {
    const graph1 = createValidGraph('15001', 'v1')
    graph1.instruments = [{ id: 'inst-1', name: 'Inst', kind: 'general', evidenceIds: ['ev-1'] }]
    await repo.register(graph1)
    
    const graph2 = createValidGraph('15001', 'v2')
    graph2.instruments = [{ id: 'inst-2', name: 'Inst2', kind: 'general' }]
    graph2.evidences = []
    graph2.evidenceLinks = []
    await repo.register(graph2)
    
    const res = await repo.getByMunicipality('15001')
    expect(res.status).toBe('ambiguous')
    if (res.status === 'ambiguous') {
      expect(res.candidates.length).toBe(2)
    }
  })

  it('8. Consulta explícita de una versión', async () => {
    const graph1 = createValidGraph('15001', 'v1')
    graph1.instruments = [{ id: 'inst-1', name: 'Inst', kind: 'general', evidenceIds: ['ev-1'] }]
    await repo.register(graph1)
    
    const graph2 = createValidGraph('15001', 'v2')
    graph2.instruments = [{ id: 'inst-2', name: 'Inst2', kind: 'general' }]
    graph2.evidences = []
    graph2.evidenceLinks = []
    await repo.register(graph2)
    
    const res = await repo.getByIdentity({ municipalityCode: '15001', version: 'v2' })
    expect(res.status).toBe('found')
    if (res.status === 'found') {
      expect(res.value.version).toBe('v2')
    }
  })

  it('9. Listado global', async () => {
    const graph1 = createValidGraph('15001', 'v1')
    graph1.instruments = [{ id: 'inst-1', name: 'Inst', kind: 'general', evidenceIds: ['ev-1'] }]
    await repo.register(graph1)
    
    const graph2 = createValidGraph('15002', 'v1')
    graph2.instruments = [{ id: 'inst-2', name: 'Inst', kind: 'general' }]
    graph2.evidences = []
    graph2.evidenceLinks = []
    await repo.register(graph2)
    
    const list = await repo.list()
    expect(list.length).toBe(2)
  })

  it('10. Listado filtrado por municipio', async () => {
    const graph1 = createValidGraph('15001', 'v1')
    graph1.instruments = [{ id: 'inst-1', name: 'Inst', kind: 'general', evidenceIds: ['ev-1'] }]
    await repo.register(graph1)
    
    const graph2 = createValidGraph('15002', 'v1')
    graph2.instruments = [{ id: 'inst-2', name: 'Inst', kind: 'general' }]
    graph2.evidences = []
    graph2.evidenceLinks = []
    await repo.register(graph2)
    
    const list = await repo.list('15001')
    expect(list.length).toBe(1)
    expect(list[0].municipalityCode).toBe('15001')
  })

  it('11. Dos instancias tienen estado aislado', async () => {
    const repo2 = new InMemoryPlanningKnowledgeGraphRepository()
    const graph = createValidGraph('15001', 'v1')
    graph.instruments = [{ id: 'inst-1', name: 'Inst', kind: 'general', evidenceIds: ['ev-1'] }]
    
    await repo.register(graph)
    
    const list1 = await repo.list()
    const list2 = await repo2.list()
    
    expect(list1.length).toBe(1)
    expect(list2.length).toBe(0)
  })

  it('12. Mutar el original tras register no altera el repositorio', async () => {
    const graph = createValidGraph('15001', 'v1')
    graph.instruments = [{ id: 'inst-1', name: 'Inst', kind: 'general', evidenceIds: ['ev-1'] }]
    await repo.register(graph)
    
    graph.version = 'v99'
    graph.instruments[0].name = 'Hacked'
    
    const res = await repo.getByIdentity({ municipalityCode: '15001', version: 'v1' })
    expect(res.status).toBe('found')
    if (res.status === 'found') {
      expect(res.value.version).toBe('v1')
      expect(res.value.instruments[0].name).toBe('Inst')
    }
  })

  it('13. Mutar el resultado no altera el repositorio', async () => {
    const graph = createValidGraph('15001', 'v1')
    graph.instruments = [{ id: 'inst-1', name: 'Inst', kind: 'general', evidenceIds: ['ev-1'] }]
    await repo.register(graph)
    
    const res1 = await repo.getByIdentity({ municipalityCode: '15001', version: 'v1' })
    if (res1.status === 'found') {
      res1.value.version = 'v99'
      res1.value.instruments[0].name = 'Hacked'
    }
    
    const res2 = await repo.getByIdentity({ municipalityCode: '15001', version: 'v1' })
    expect(res2.status).toBe('found')
    if (res2.status === 'found') {
      expect(res2.value.version).toBe('v1')
      expect(res2.value.instruments[0].name).toBe('Inst')
    }
  })

  it('14. Un registro inválido no deja estado parcial', async () => {
    const graph = createValidGraph('15001', 'v1')
    graph.instruments = [
      { id: 'inst-1', name: 'Inst', kind: 'general' },
      { id: 'inst-1', name: 'Inst2', kind: 'general' }
    ] // duplicate instrument id makes it invalid
    await repo.register(graph)
    
    const list = await repo.list()
    expect(list.length).toBe(0)
  })

  it('15. Evidences y evidenceLinks sobreviven structuredClone', async () => {
    const graph = createValidGraph('15001', 'v1')
    graph.instruments = [{ id: 'inst-1', name: 'Inst', kind: 'general', evidenceIds: ['ev-1'] }]
    await repo.register(graph)
    
    const res = await repo.getByIdentity({ municipalityCode: '15001', version: 'v1' })
    expect(res.status).toBe('found')
    if (res.status === 'found') {
      expect(res.value.evidences).toBeDefined()
      expect(res.value.evidences!.length).toBe(1)
      expect(res.value.evidenceLinks).toBeDefined()
      expect(res.value.evidenceLinks!.length).toBe(1)
      expect(res.value.evidences![0].id).toBe('ev-1')
    }
  })

  it('16. Duplicate devuelve copia defensiva del existente', async () => {
    const graph1 = createValidGraph('15001', 'v1')
    graph1.instruments = [{ id: 'inst-1', name: 'Inst', kind: 'general', evidenceIds: ['ev-1'] }]
    await repo.register(graph1)
    
    const graph2 = createValidGraph('15001', 'v1')
    graph2.evidences = []
    graph2.evidenceLinks = []
    const res = await repo.register(graph2) // duplicate
    
    if (res.status === 'duplicate') {
      res.existing.instruments[0].name = 'Hacked'
    }
    
    const check = await repo.getByIdentity({ municipalityCode: '15001', version: 'v1' })
    if (check.status === 'found') {
      expect(check.value.instruments[0].name).toBe('Inst')
    }
  })

  it('17. Version vacía produce invalid', async () => {
    const graph = createValidGraph('15001', '')
    graph.evidences = []
    graph.evidenceLinks = []
    const res = await repo.register(graph)
    expect(res.status).toBe('invalid')
    if (res.status === 'invalid') {
      expect(res.errors.some(e => e.code === 'EMPTY_GRAPH_VERSION')).toBe(true)
    }
  })

  it('18. No existe elección silenciosa de versión', async () => {
    const graph1 = createValidGraph('15001', 'v1')
    graph1.instruments = [{ id: 'inst-1', name: 'Inst', kind: 'general', evidenceIds: ['ev-1'] }]
    await repo.register(graph1)
    
    const graph2 = createValidGraph('15001', 'v2')
    graph2.instruments = [{ id: 'inst-2', name: 'Inst2', kind: 'general' }]
    graph2.evidences = []
    graph2.evidenceLinks = []
    await repo.register(graph2)
    
    const res = await repo.getByMunicipality('15001')
    // It should not silently pick v1 or v2
    expect(res.status).toBe('ambiguous')
  })

  it('19. Las firmas públicas devuelven Promise', async () => {
    const graph = createValidGraph('15001', 'v1')
    graph.instruments = [{ id: 'inst-1', name: 'Inst', kind: 'general', evidenceIds: ['ev-1'] }]
    const promise = repo.register(graph)
    expect(promise instanceof Promise).toBe(true)
    await promise
  })

  it('20. No existe lógica específica de municipio en producción', async () => {
    const graph = createValidGraph('CULLEREDO_XYZ', 'v1')
    graph.instruments = [{ id: 'inst-1', name: 'Inst', kind: 'general', evidenceIds: ['ev-1'] }]
    const res = await repo.register(graph)
    expect(res.status).toBe('registered')
    const check = await repo.getByIdentity({ municipalityCode: 'CULLEREDO_XYZ', version: 'v1' })
    expect(check.status).toBe('found')
  })

  it('21. getByIdentity devuelve invalid_query si municipalityCode está vacío', async () => {
    const res = await repo.getByIdentity({ municipalityCode: '', version: 'v1' })
    expect(res.status).toBe('invalid_query')
  })

  it('22. getByIdentity devuelve invalid_query si version está vacía', async () => {
    const res = await repo.getByIdentity({ municipalityCode: '15001', version: '' })
    expect(res.status).toBe('invalid_query')
  })

  it('23. getByMunicipality devuelve invalid_query si municipalityCode está vacío', async () => {
    const res = await repo.getByMunicipality('')
    expect(res.status).toBe('invalid_query')
  })

  it('24. structuredClone fail-closed no altera estado interno', async () => {
    const graph1 = createValidGraph('15001', 'v1')
    graph1.instruments = [{ id: 'inst-1', name: 'Inst', kind: 'general', evidenceIds: ['ev-1'] }]
    await repo.register(graph1)

    const graph2 = createValidGraph('15002', 'v1')
    graph2.evidences = []
    graph2.evidenceLinks = []
    // Introducimos un objeto no clonable (un Proxy o una función)
    ;(graph2 as any).uncloneable = () => {}

    await expect(repo.register(graph2)).rejects.toThrow()

    // El estado no debe haber sido alterado
    const list = await repo.list()
    expect(list.length).toBe(1)
  })
})
