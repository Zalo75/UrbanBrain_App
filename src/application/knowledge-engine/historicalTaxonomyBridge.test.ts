import { describe, expect, it } from 'vitest'
import { buildHistoricalTaxonomyBridge, expandHistoricalTaxonomyQuery } from './historicalTaxonomyBridge'
import { buildHistoricalCoverageQueries, mergeHistoricalCoverageResults } from './historicalCoverageRetrieval'

describe('HistoricalTaxonomyBridge', () => {
  it('does not expand a modern plan whose category is already legal/current', () => {
    const bridge = buildHistoricalTaxonomyBridge({ approvalDate: '2022-01-01', cla_homo: 'SU', cat_homo: 'SUC', cat_ley: 'SUC', instrumentType: 'PXOM' })
    expect(bridge.originalPlanSearchTerms).toEqual([])
  })

  it('expands historical NNSS vocabulary without selecting an ordinance', () => {
    const bridge = buildHistoricalTaxonomyBridge({ approvalDate: '1993-02-12', cla_homo: 'SU', cat_homo: 'SUSC', cat_ley: '', instrumentType: 'NORMAS SUBSIDIARIAS DE PLANEAMENTO' })
    expect(bridge.canonicalCurrentIdentity).toEqual({ classification: 'SU', category: 'SUSC' })
    expect(bridge.originalPlanSearchTerms).toEqual(expect.arrayContaining(['Suelo Urbano', 'PERI', 'Unidades de Actuación Urbanística']))
    expect(bridge.provenance).toContain('modern_homogeneous_category_without_legal_category')
  })

  it('prefers official detected historical terms and keeps them auditable', () => {
    const bridge = buildHistoricalTaxonomyBridge({ instrumentType: 'NNSS', cat_homo: 'SUSC', detectedHistoricalTerms: ['Unidad de Actuación U.A.U.'] })
    expect(bridge.originalPlanSearchTerms).toContain('Unidad de Actuación U.A.U.')
    expect(bridge.confidence).toBe('medium')
  })

  it('does not apply historical vocabulary to an unrelated instrument type', () => {
    const bridge = buildHistoricalTaxonomyBridge({ approvalDate: '2022-02-12', cla_homo: 'SU', cat_homo: 'SUSC', instrumentType: 'PXOM' })
    expect(bridge.originalPlanSearchTerms).toEqual([])
  })

  it('only enriches retrieval text and leaves the visible question unchanged', () => {
    const question = '¿Qué artículos regulan SUSC?'
    const bridge = buildHistoricalTaxonomyBridge({ instrumentType: 'NNSS', cat_homo: 'SUSC' })
    expect(expandHistoricalTaxonomyQuery(question, bridge)).toContain(question)
    expect(question).toBe('¿Qué artículos regulan SUSC?')
  })

  it('does not invent equivalence when no historical category is available', () => {
    const bridge = buildHistoricalTaxonomyBridge({ instrumentType: 'NNSS', cla_homo: 'SU' })
    expect(bridge.originalPlanSearchTerms).toEqual([])
    expect(bridge.confidence).toBe('none')
  })

  it('generates bounded coverage queries from bridge terms', () => {
    const bridge = buildHistoricalTaxonomyBridge({ instrumentType: 'NNSS', cat_homo: 'SUSC' })
    const queries = buildHistoricalCoverageQueries('¿Qué artículos regulan SUSC?', bridge, 5)
    expect(queries).toHaveLength(5)
    expect(queries[0]).toBe('¿Qué artículos regulan SUSC?')
    expect(new Set(queries).size).toBe(5)
  })

  it('deduplicates repeated chunks from multiple searches while preserving coverage', () => {
    const merged = mergeHistoricalCoverageResults([
      [{ chunk_id: 'a' }, { chunk_id: 'b' }],
      [{ chunk_id: 'b' }, { chunk_id: 'c' }],
    ])
    expect(merged.map((row) => row.chunk_id)).toEqual(['a', 'b', 'c'])
  })
})
