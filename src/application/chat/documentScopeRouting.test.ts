import { describe, expect, it } from 'vitest'

import type { NormativeSearchScope } from '@/application/parcel-context/normativeSearchScope'
import { shouldUseDocumentScope } from './documentScopeRouting'

function scope(overrides: Partial<NormativeSearchScope> = {}): NormativeSearchScope {
  return {
    municipioCodigo: '36059',
    instrumentId: '23045',
    documentIds: ['doc-23045'],
    documentNames: ['nnss.pdf'],
    actionAreaValidated: true,
    source: 'automatic',
    confidence: 'unknown',
    reason: '',
    ...overrides,
  }
}

describe('document scope routing', () => {
  it.each([
    '¿Qué establece la normativa de las NNSS para el SUSC?',
    '¿Qué artículos o apartados regulan específicamente el SUSC?',
    '¿Qué dice la normativa sobre suelo urbano sin consolidar?',
  ])('preserva document_scope para una consulta documental: %s', (question) => {
    expect(shouldUseDocumentScope(question, scope())).toBe(true)
  })

  it('preserva las barreras de una pregunta parcelaria concreta sin exigir que exista ordenanza', () => {
    expect(shouldUseDocumentScope('¿Qué retranqueo tiene esta parcela?', scope())).toBe(true)
  })

  it('rechaza el document scope si falta el instrumento', () => {
    expect(shouldUseDocumentScope('¿Qué artículos regulan el SUSC?', scope({ instrumentId: undefined }))).toBe(false)
  })

  it('rechaza el document scope si faltan documentos', () => {
    expect(shouldUseDocumentScope('¿Qué artículos regulan el SUSC?', scope({ documentIds: undefined, documentNames: undefined }))).toBe(false)
  })

  it('rechaza el document scope si falta el municipio canónico', () => {
    expect(shouldUseDocumentScope('¿Qué artículos regulan el SUSC?', scope({ municipioCodigo: '' }))).toBe(false)
  })

  it('no confunde un municipio distinto con el municipio del expediente', () => {
    expect(shouldUseDocumentScope('¿Qué artículos regulan el SUSC?', scope({ municipioCodigo: '15030' }), '36059')).toBe(false)
    expect(shouldUseDocumentScope('¿Qué artículos regulan el SUSC?', scope(), '36059')).toBe(true)
  })
})
