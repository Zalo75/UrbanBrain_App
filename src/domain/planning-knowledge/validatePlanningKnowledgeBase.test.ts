import { describe, it, expect } from 'vitest'
import { validatePlanningKnowledgeGraph } from './validatePlanningKnowledgeBase'
import type { PlanningKnowledgeGraph } from './pkbTypes'

describe('validatePlanningKnowledgeGraph', () => {
  const createBaseGraph = (): PlanningKnowledgeGraph => ({
    municipalityCode: '15009',
    municipalityName: 'Betanzos',
    version: 'v1',
    instruments: [],
    dispositions: [],
    relationships: []
  })

  it('22. Version vacía produce invalid', () => {
    const graph = createBaseGraph()
    graph.version = ''
    const errors = validatePlanningKnowledgeGraph(graph)
    expect(errors.some(e => e.code === 'EMPTY_GRAPH_VERSION')).toBe(true)
  })

  it('23. MunicipalityCode vacío produce invalid', () => {
    const graph = createBaseGraph()
    graph.municipalityCode = ''
    const errors = validatePlanningKnowledgeGraph(graph)
    expect(errors.some(e => e.code === 'EMPTY_MUNICIPALITY_CODE')).toBe(true)
  })

  it('1. ID de instrumento duplicado', () => {
    const graph = createBaseGraph()
    graph.instruments = [
      { id: 'inst-1', name: 'Inst 1', kind: 'general' },
      { id: 'inst-1', name: 'Inst 2', kind: 'development' }
    ]
    const errors = validatePlanningKnowledgeGraph(graph)
    expect(errors.some(e => e.code === 'DUPLICATE_INSTRUMENT_ID')).toBe(true)
  })

  it('2. ID de disposición duplicado', () => {
    const graph = createBaseGraph()
    graph.dispositions = [
      { id: 'disp-1', instrumentId: 'inst-1', type: 'article', code: '1', name: 'Art 1' },
      { id: 'disp-1', instrumentId: 'inst-2', type: 'article', code: '2', name: 'Art 2' }
    ]
    const errors = validatePlanningKnowledgeGraph(graph)
    expect(errors.some(e => e.code === 'DUPLICATE_DISPOSITION_ID')).toBe(true)
  })

  it('3. source inexistente', () => {
    const graph = createBaseGraph()
    graph.relationships = [
      {
        id: 'rel-1',
        source: { kind: 'instrument', id: 'inst-1' },
        target: { kind: 'instrument', id: 'inst-2' },
        type: 'MODIFIES'
      }
    ]
    graph.instruments = [{ id: 'inst-2', name: 'Inst 2', kind: 'general' }]
    const errors = validatePlanningKnowledgeGraph(graph)
    expect(errors.some(e => e.code === 'INVALID_RELATION_SOURCE')).toBe(true)
  })

  it('4. target inexistente', () => {
    const graph = createBaseGraph()
    graph.relationships = [
      {
        id: 'rel-1',
        source: { kind: 'instrument', id: 'inst-1' },
        target: { kind: 'instrument', id: 'inst-2' },
        type: 'MODIFIES'
      }
    ]
    graph.instruments = [{ id: 'inst-1', name: 'Inst 1', kind: 'general' }]
    const errors = validatePlanningKnowledgeGraph(graph)
    expect(errors.some(e => e.code === 'INVALID_RELATION_TARGET')).toBe(true)
  })

  it('5. kind incorrecto para un ID existente', () => {
    const graph = createBaseGraph()
    // ID exists as disposition, but relation asks for instrument
    graph.dispositions = [{ id: 'id-1', instrumentId: 'inst-1', type: 'article', code: '1', name: 'Art 1' }]
    graph.relationships = [
      {
        id: 'rel-1',
        source: { kind: 'instrument', id: 'id-1' },
        target: { kind: 'disposition', id: 'id-1' },
        type: 'MODIFIES'
      }
    ]
    const errors = validatePlanningKnowledgeGraph(graph)
    expect(errors.some(e => e.code === 'INVALID_RELATION_SOURCE')).toBe(true) // Should fail because id-1 is not in instruments
  })

  it('6. parentDispositionId inexistente', () => {
    const graph = createBaseGraph()
    graph.instruments = [{ id: 'inst-1', name: 'Inst', kind: 'general' }]
    graph.dispositions = [
      { id: 'disp-1', instrumentId: 'inst-1', type: 'article', code: '1', name: 'Art 1', parentDispositionId: 'disp-unknown' }
    ]
    const errors = validatePlanningKnowledgeGraph(graph)
    expect(errors.some(e => e.code === 'INVALID_PARENT_DISPOSITION_ID')).toBe(true)
  })

  it('7. parentDispositionId de otro instrumento', () => {
    const graph = createBaseGraph()
    graph.instruments = [
      { id: 'inst-1', name: 'Inst 1', kind: 'general' },
      { id: 'inst-2', name: 'Inst 2', kind: 'general' }
    ]
    graph.dispositions = [
      { id: 'disp-parent', instrumentId: 'inst-1', type: 'chapter', code: '1', name: 'Chapter 1' },
      { id: 'disp-child', instrumentId: 'inst-2', type: 'article', code: '1', name: 'Article 1', parentDispositionId: 'disp-parent' }
    ]
    const errors = validatePlanningKnowledgeGraph(graph)
    expect(errors.some(e => e.code === 'CROSS_INSTRUMENT_PARENT_DISPOSITION')).toBe(true)
  })

  it('8. ciclo estructural entre disposiciones', () => {
    const graph = createBaseGraph()
    graph.instruments = [{ id: 'inst-1', name: 'Inst', kind: 'general' }]
    graph.dispositions = [
      { id: 'disp-1', instrumentId: 'inst-1', type: 'article', code: '1', name: 'A', parentDispositionId: 'disp-3' },
      { id: 'disp-2', instrumentId: 'inst-1', type: 'article', code: '2', name: 'B', parentDispositionId: 'disp-1' },
      { id: 'disp-3', instrumentId: 'inst-1', type: 'article', code: '3', name: 'C', parentDispositionId: 'disp-2' }
    ]
    const errors = validatePlanningKnowledgeGraph(graph)
    expect(errors.some(e => e.code === 'CIRCULAR_STRUCTURAL_DEPENDENCY')).toBe(true)
  })

  it('9. relación válida instrumento -> instrumento', () => {
    const graph = createBaseGraph()
    graph.instruments = [
      { id: 'inst-1', name: 'Inst 1', kind: 'general' },
      { id: 'inst-2', name: 'Inst 2', kind: 'development' }
    ]
    graph.relationships = [
      {
        id: 'rel-1',
        source: { kind: 'instrument', id: 'inst-2' },
        target: { kind: 'instrument', id: 'inst-1' },
        type: 'DEVELOPS'
      }
    ]
    const errors = validatePlanningKnowledgeGraph(graph)
    expect(errors.length).toBe(0)
  })

  it('10. relación válida instrumento -> disposición', () => {
    const graph = createBaseGraph()
    graph.instruments = [
      { id: 'inst-1', name: 'Inst 1', kind: 'general' },
      { id: 'inst-2', name: 'Inst 2', kind: 'development' }
    ]
    graph.dispositions = [
      { id: 'disp-1', instrumentId: 'inst-1', type: 'article', code: '1', name: 'Art 1' }
    ]
    graph.relationships = [
      {
        id: 'rel-1',
        source: { kind: 'instrument', id: 'inst-2' },
        target: { kind: 'disposition', id: 'disp-1' },
        type: 'SUSPENDS'
      }
    ]
    const errors = validatePlanningKnowledgeGraph(graph)
    expect(errors.length).toBe(0)
  })

  it('11. relación válida disposición -> disposición', () => {
    const graph = createBaseGraph()
    graph.instruments = [
      { id: 'inst-1', name: 'Inst 1', kind: 'general' },
      { id: 'inst-2', name: 'Inst 2', kind: 'development' }
    ]
    graph.dispositions = [
      { id: 'disp-1', instrumentId: 'inst-1', type: 'article', code: '1', name: 'Art 1' },
      { id: 'disp-2', instrumentId: 'inst-2', type: 'article', code: '2', name: 'Art 2' }
    ]
    graph.relationships = [
      {
        id: 'rel-1',
        source: { kind: 'disposition', id: 'disp-2' },
        target: { kind: 'disposition', id: 'disp-1' },
        type: 'MODIFIES'
      }
    ]
    const errors = validatePlanningKnowledgeGraph(graph)
    expect(errors.length).toBe(0)
  })

  it('12. serialización JSON completa', () => {
    const graph = createBaseGraph()
    graph.instruments = [
      { id: 'inst-1', name: 'Inst 1', kind: 'general' }
    ]
    const jsonStr = JSON.stringify(graph)
    const parsed = JSON.parse(jsonStr)
    expect(parsed.instruments[0].id).toBe('inst-1')
  })

  it('13. Validity, Assessment y evidenceIds ausentes no generan datos inventados', () => {
    const graph = createBaseGraph()
    graph.instruments = [
      { id: 'inst-1', name: 'Inst 1', kind: 'general' } // No validity, assessment, evidenceIds
    ]
    expect(graph.instruments[0].validity).toBeUndefined()
    expect(graph.instruments[0].assessment).toBeUndefined()
    expect(graph.instruments[0].evidenceIds).toBeUndefined()
  })

  // Evidence validation tests
  it('14. ID de Evidence duplicado', () => {
    const graph = createBaseGraph()
    graph.evidences = [
      { id: 'ev-1', subjectId: 'inst-1', kind: 'document', createdAt: '2023-01-01' },
      { id: 'ev-1', subjectId: 'inst-2', kind: 'document', createdAt: '2023-01-02' }
    ]
    const errors = validatePlanningKnowledgeGraph(graph)
    expect(errors.some(e => e.code === 'DUPLICATE_EVIDENCE_ID')).toBe(true)
  })

  it('15. evidenceId del link inexistente', () => {
    const graph = createBaseGraph()
    graph.instruments = [{ id: 'inst-1', name: 'Inst', kind: 'general' }]
    graph.evidenceLinks = [
      { evidenceId: 'ev-1', subject: { kind: 'instrument', id: 'inst-1' } }
    ]
    const errors = validatePlanningKnowledgeGraph(graph)
    expect(errors.some(e => e.code === 'INVALID_LINK_EVIDENCE_ID')).toBe(true)
  })

  it('16. sujeto inexistente o kind incorrecto', () => {
    const graph = createBaseGraph()
    graph.evidences = [{ id: 'ev-1', subjectId: 'unknown', kind: 'document', createdAt: '2023-01-01' }]
    graph.evidenceLinks = [
      { evidenceId: 'ev-1', subject: { kind: 'instrument', id: 'unknown-inst' } }
    ]
    const errors = validatePlanningKnowledgeGraph(graph)
    expect(errors.some(e => e.code === 'INVALID_LINK_SUBJECT_ID')).toBe(true)
  })

  it('17. evidenceIds de un nodo sin link correspondiente', () => {
    const graph = createBaseGraph()
    graph.evidences = [{ id: 'ev-1', subjectId: 'inst-1', kind: 'document', createdAt: '2023-01-01' }]
    graph.instruments = [{ id: 'inst-1', name: 'Inst', kind: 'general', evidenceIds: ['ev-1'] }]
    // No evidenceLinks provided
    const errors = validatePlanningKnowledgeGraph(graph)
    expect(errors.some(e => e.code === 'MISSING_EVIDENCE_LINK')).toBe(true)
  })

  it('18. link cuyo evidenceId no aparece en evidenceIds del sujeto', () => {
    const graph = createBaseGraph()
    graph.evidences = [{ id: 'ev-1', subjectId: 'inst-1', kind: 'document', createdAt: '2023-01-01' }]
    graph.instruments = [{ id: 'inst-1', name: 'Inst', kind: 'general' }] // evidenceIds missing
    graph.evidenceLinks = [
      { evidenceId: 'ev-1', subject: { kind: 'instrument', id: 'inst-1' } }
    ]
    const errors = validatePlanningKnowledgeGraph(graph)
    expect(errors.some(e => e.code === 'UNDECLARED_EVIDENCE_LINK')).toBe(true)
  })

  it('19. links válidos a instrumento, disposición y relación', () => {
    const graph = createBaseGraph()
    graph.instruments = [{ id: 'inst-1', name: 'Inst', kind: 'general', evidenceIds: ['ev-inst'] }]
    graph.dispositions = [{ id: 'disp-1', instrumentId: 'inst-1', type: 'art', code: '1', name: 'A', evidenceIds: ['ev-disp'] }]
    graph.relationships = [{ id: 'rel-1', source: { kind: 'instrument', id: 'inst-1' }, target: { kind: 'disposition', id: 'disp-1'}, type: 'MODIFIES', evidenceIds: ['ev-rel'] }]

    graph.evidences = [
      { id: 'ev-inst', subjectId: 'inst-1', kind: 'document', createdAt: '2023-01-01' },
      { id: 'ev-disp', subjectId: 'disp-1', kind: 'document', createdAt: '2023-01-01' },
      { id: 'ev-rel', subjectId: 'rel-1', kind: 'document', createdAt: '2023-01-01' }
    ]

    graph.evidenceLinks = [
      { evidenceId: 'ev-inst', subject: { kind: 'instrument', id: 'inst-1' } },
      { evidenceId: 'ev-disp', subject: { kind: 'disposition', id: 'disp-1' } },
      { evidenceId: 'ev-rel', subject: { kind: 'relationship', id: 'rel-1' } }
    ]

    const errors = validatePlanningKnowledgeGraph(graph)
    expect(errors.length).toBe(0)
  })

  it('20. Evidence sin link puede existir', () => {
    const graph = createBaseGraph()
    graph.evidences = [{ id: 'ev-orphaned', subjectId: 'unknown', kind: 'document', createdAt: '2023-01-01' }]
    const errors = validatePlanningKnowledgeGraph(graph)
    expect(errors.length).toBe(0) // Should not error for orphaned evidence
  })

  it('21. Mismatch de subjectId explícito', () => {
    const graph = createBaseGraph()
    graph.instruments = [{ id: 'inst-1', name: 'Inst', kind: 'general', evidenceIds: ['ev-1'] }]
    graph.evidences = [{ id: 'ev-1', subjectId: 'wrong-id', kind: 'document', createdAt: '2023-01-01' }]
    graph.evidenceLinks = [
      { evidenceId: 'ev-1', subject: { kind: 'instrument', id: 'inst-1' } }
    ]
    const errors = validatePlanningKnowledgeGraph(graph)
    expect(errors.some(e => e.code === 'EVIDENCE_SUBJECT_MISMATCH')).toBe(true)
  })
})
