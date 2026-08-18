import { describe, expect, it } from 'vitest'
import { parseStructuralHeading, processDocumentChunks } from './backfillMetadata'
import { evaluateApplicability } from '@/application/parcel-context/applicabilityEngine'
import type { NormalizedParcelContext, NormativeCandidate } from '@/domain/parcel-context/types'

function chunk(id: string, content: string, options: Partial<Parameters<typeof processDocumentChunks>[0][number]> = {}) {
  return { id, content, chunkIndex: Number(id.replace(/\D/g, '')) || 0, ...options }
}

describe('hierarchical normative regime extractor', () => {
  it('extracts an explicit ordinance from a real article heading', () => {
    const [result] = processDocumentChunks([chunk('1', 'ARTIGO 6.2.1.- RUEIRO PECHADO. ORDENANZA SU-1', { article: '6.2.1' })])
    expect(result.metadata.regime).toMatchObject({ kind: 'ordinance', code: 'SU-1', provenance: 'explicit_heading', confidence: 'high' })
  })

  it('inherits only immediate child chunks of the same article at medium confidence', () => {
    const results = processDocumentChunks([
      chunk('1', 'ARTIGO 6.2.1.- ORDENANZA O1', { article: '6.2.1' }),
      chunk('2', 'Condiciones del artículo.', { article: '6.2.1' }),
    ])
    expect(results[1].metadata.regime).toMatchObject({ code: 'O1', provenance: 'inherited_heading', confidence: 'medium' })
  })

  it('changes regime at a new explicit article', () => {
    const results = processDocumentChunks([
      chunk('1', 'ART. 1.- ORDENANZA O1', { article: '1' }),
      chunk('2', 'ART. 2.- ORDENANZA O2', { article: '2' }),
    ])
    expect(results.map((item) => item.metadata.regime?.code)).toEqual(['O1', 'O2'])
  })

  it('does not inherit through a new article without regime evidence', () => {
    const results = processDocumentChunks([
      chunk('1', 'ART. 1.- ORDENANZA O1', { article: '1' }),
      chunk('2', 'ART. 2.- Condiciones de parcela', { article: '2' }),
      chunk('3', 'Texto posterior', { article: '2' }),
    ])
    expect(results[1].metadata.regime).toBeUndefined()
    expect(results[2].metadata.regime).toBeUndefined()
  })

  it('cuts a specific regime at a new chapter', () => {
    const results = processDocumentChunks([
      chunk('1', 'ART. 1.- ORDENANZA O1', { article: '1' }),
      chunk('2', 'CAPITULO 2 - OTRAS DETERMINACIONES', { chapter: '2' }),
      chunk('3', 'Texto del capítulo 2'),
    ])
    expect(results[1].metadata.regime).toBeUndefined()
    expect(results[2].metadata.regime).toBeUndefined()
  })

  it('marks general provisions and cuts the previous ordinance', () => {
    const results = processDocumentChunks([
      chunk('1', 'ART. 1.- ORDENANZA O1', { article: '1' }),
      chunk('2', 'DISPOSICIONES GENERALES'),
      chunk('3', 'Regla general'),
    ])
    expect(results[1].metadata.regime).toMatchObject({ kind: 'general', confidence: 'high' })
    expect(results[2].metadata.regime).toMatchObject({ kind: 'general', provenance: 'inherited_heading' })
  })

  it('keeps a cross-reference ambiguous without changing the active regime', () => {
    const results = processDocumentChunks([
      chunk('1', 'ART. 1.- ORDENANZA O1', { article: '1' }),
      chunk('2', 'La ordenanza O2 se cita como referencia.', { article: '1' }),
    ])
    expect(results[1].metadata.regime).toMatchObject({ code: 'O1', confidence: 'low', provenance: 'inherited_heading' })
    expect(results[1].metadata.regime?.ambiguity).toContain('Referencia cruzada: O2')
  })

  it('does not start a regime from an index or alter hierarchy at a page marker', () => {
    const results = processDocumentChunks([
      chunk('1', 'ÍNDICE\nORDENANZA O1 ........ 5'),
      chunk('2', 'ART. 1.- ORDENANZA O1', { article: '1' }),
      chunk('3', '--- PAGINA 2 ---'),
      chunk('4', 'Continuación', { article: '1' }),
    ])
    expect(results[0].metadata.regime).toBeUndefined()
    expect(results[2].metadata.regime).toBeUndefined()
    expect(results[3].metadata.regime?.code).toBe('O1')
  })

  it('accepts OCR-tolerant article forms and extracts identity without inventing a code', () => {
    expect(parseStructuralHeading('ARTIGO 7.2.1.- NÚCLEO RURAL DE ORIXE TRADICIONAL. ORDENANZA NRH')?.regime).toMatchObject({ code: 'NRH' })
    expect(parseStructuralHeading('ART. 40.- (PV) ORDENANZA DE SOLO NON URBANIZABLE')?.regime).toMatchObject({ code: 'PV' })
    expect(parseStructuralHeading('ARTÍCULO 6.2.1  -  ORDENANZA SU-1')?.kind).toBe('article')
  })

  it('treats a chapter of urban ordinances as general context, not an artificial ordinance', () => {
    const parsed = parseStructuralHeading('CAPITULO 2 - ORDENANZAS REGULADORAS EN SOLO URBANO')
    expect(parsed).toMatchObject({ kind: 'general', regime: { kind: 'general' } })
    expect(parsed?.regime?.code).toBeUndefined()
  })

  it('handles O1 to O2 to general transitions deterministically', () => {
    const results = processDocumentChunks([
      chunk('1', 'ART. 1.- ORDENANZA O1', { article: '1' }),
      chunk('2', 'ART. 2.- ORDENANZA O2', { article: '2' }),
      chunk('3', 'NORMAS XERAIS'),
      chunk('4', 'Aplicación general'),
    ])
    expect(results.map((item) => item.metadata.regime?.code ?? item.metadata.regime?.kind)).toEqual(['O1', 'O2', 'general', 'general'])
  })

  it('has no municipality-specific branch and remains bounded under repeated sections', () => {
    const chunks = Array.from({ length: 30 }, (_, index) =>
      chunk(String(index + 1), index % 3 === 0 ? `ART. ${index + 1}.- ORDENANZA O${index + 1}` : 'Texto', { article: index % 3 === 0 ? String(index + 1) : undefined })
    )
    const results = processDocumentChunks(chunks)
    expect(results.filter((item) => item.metadata.regime?.provenance === 'inherited_heading').length).toBeLessThan(20)
  })

  it('does not promote low-confidence extracted metadata to APPLICABLE', () => {
    const context = {
      municipality: { value: { name: 'Municipio X' }, source: 'manual', confidence: 1, verification: 'confirmed' },
      qualification: { value: 'O1', source: 'manual', confidence: 1, verification: 'confirmed' },
      knownConstraints: [],
      conflicts: [],
      pendingValidation: [],
    } as NormalizedParcelContext
    const candidate = {
      id: 'candidate-1',
      content: 'Retranqueo y ocupación.',
      municipalityName: 'Municipio X',
      regimeMetadata: { kind: 'ordinance', code: 'O1', provenance: 'inherited_heading', confidence: 'low' },
    } as NormativeCandidate
    const result = evaluateApplicability(context, [candidate], true)
    expect(result.applicable).toHaveLength(0)
    expect(result.review).toHaveLength(1)
  })
})
