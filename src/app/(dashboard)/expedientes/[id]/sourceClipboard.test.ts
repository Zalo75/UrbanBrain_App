import { describe, expect, it } from 'vitest'

import {
  buildSourceCitationText,
  getCopyableSourceFragment,
  normalizeSourcePage,
} from './sourceClipboard'

describe('sourceClipboard', () => {
  it('prefers the normalized complete fragment and preserves internal newlines and Unicode', () => {
    expect(getCopyableSourceFragment({
      fragmento_completo: '  Primera línea.\nSegunda línea con área.  ',
      fragmento_corto: 'Resumen',
    })).toBe('Primera línea.\nSegunda línea con área.')
  })

  it('falls back to the short fragment', () => {
    expect(getCopyableSourceFragment({ fragmento_completo: null, fragmento_corto: '  Resumen  ' })).toBe('Resumen')
  })

  it.each([undefined, null, '', '   ', 'null', ' NULL ', 'undefined', ' Undefined ', '[undefined]', '[Fuente undefined]', '[null]'])(
    'rejects a non-copyable fragment: %s',
    (fragment) => {
      expect(getCopyableSourceFragment({ fragmento_completo: fragment, fragmento_corto: fragment })).toBeNull()
    }
  )

  it('includes only normalized, real metadata in the citation', () => {
    expect(buildSourceCitationText({
      fragmento_completo: '  Texto aplicable.  ',
      nombre_pdf: '  Normas urbanísticas.pdf  ',
      titulo_detectado: '  Artículo 12.3  ',
      pagina_detectada: ' Página 4 ',
      original_path: 'https://example.test/normas.pdf',
    })).toBe(
      '«Texto aplicable.»\n\nFuente: Normas urbanísticas.pdf\nReferencia detectada: Artículo 12.3\nPágina: 4\nOrigen oficial: https://example.test/normas.pdf'
    )
  })

  it('does not invent a generic document attribution or optional metadata', () => {
    expect(buildSourceCitationText({ fragmento_corto: 'Texto', nombre_pdf: 'Documento' })).toBe('«Texto»')
  })

  it.each(['sin determinar', 'null', 'undefined'])(
    'omits the invalid detected reference %s',
    (reference) => {
      expect(buildSourceCitationText({ fragmento_corto: 'Texto', titulo_detectado: reference })).toBe('«Texto»')
    }
  )

  it.each([
    [4, '4'],
    [' 4 ', '4'],
    ['4-5', '4-5'],
    ['4 – 5', '4-5'],
    ['Página 4', '4'],
    ['pág. 4-5', '4-5'],
  ])('normalizes the valid page %s', (page, expected) => {
    expect(normalizeSourcePage(page)).toBe(expected)
  })

  it.each([undefined, null, '', 'null', 'undefined', 0, -1, 1.5, '0', '-4', '5-4', '4-foo']) (
    'rejects the invalid page %s',
    (page) => {
      expect(normalizeSourcePage(page)).toBeNull()
    }
  )

  it('includes safe HTTP(S) URLs and omits unsafe or credentialed URLs', () => {
    expect(buildSourceCitationText({ fragmento_corto: 'Texto', original_path: 'https://example.test/ficha' })).toContain(
      'Origen oficial: https://example.test/ficha'
    )
    expect(buildSourceCitationText({ fragmento_corto: 'Texto', original_path: 'javascript:alert(1)' })).toBe('«Texto»')
    expect(buildSourceCitationText({ fragmento_corto: 'Texto', original_path: 'https://user:pass@example.test/a' })).toBe(
      '«Texto»'
    )
    expect(buildSourceCitationText({ fragmento_corto: 'Texto', original_path: 'D:\\corpus\\norma.pdf' })).toBe('«Texto»')
    expect(buildSourceCitationText({ fragmento_corto: 'Texto', original_path: 'file:///D:/corpus/norma.pdf' })).toBe('«Texto»')
    expect(buildSourceCitationText({ fragmento_corto: 'Texto', original_path: 'data:application/pdf;base64,abc' })).toBe('«Texto»')
  })

  it('prefers the explicit official URL over a legacy local path', () => {
    expect(buildSourceCitationText({ fragmento_corto: 'Texto', official_url: 'https://official.test/norma.pdf', original_path: 'D:\\corpus\\norma.pdf' }))
      .toContain('Origen oficial: https://official.test/norma.pdf')
  })

  it('returns null when no fragment can be copied', () => {
    expect(buildSourceCitationText({ fragmento_completo: 'null', fragmento_corto: ' undefined ' })).toBeNull()
  })
})
