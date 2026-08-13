import { describe, expect, it } from 'vitest'

import {
  buildPdfPageUrl,
  buildPdfUrl,
  buildSafeHttpUrl,
  extractValidPageNumber,
  parseCitations,
} from './chatCitations'

describe('parseCitations', () => {
  it('tokenizes valid citations without needing a global source list', () => {
    expect(parseCitations('Según la [Fuente 1], esto es cierto.')).toEqual([
      { type: 'text', value: 'Según la ' },
      { type: 'citation', sourceIndex: 1, originalText: '[Fuente 1]' },
      { type: 'text', value: ', esto es cierto.' },
    ])
  })

  it('accepts case and surrounding whitespace in Fuente', () => {
    expect(parseCitations('[fUeNtE   12]')).toEqual([
      { type: 'citation', sourceIndex: 12, originalText: '[fUeNtE   12]' },
    ])
  })

  it('preserves malformed citations and unrelated bracketed content literally', () => {
    const content = '[Fuente 0] [Fuente -1] [Fuente uno] [Documento 1] [Fuente 2'

    expect(parseCitations(content)).toEqual([{ type: 'text', value: content }])
  })

  it('keeps Markdown text outside the citation contract', () => {
    const content = 'Consulta [Fuente 1](https://example.test/norma.pdf) y [BOE](https://boe.es).'

    expect(parseCitations(content)).toEqual([{ type: 'text', value: content }])
  })

  it('supports repeated citations to the same source', () => {
    expect(parseCitations('[Fuente 1] y [Fuente 1].')).toEqual([
      { type: 'citation', sourceIndex: 1, originalText: '[Fuente 1]' },
      { type: 'text', value: ' y ' },
      { type: 'citation', sourceIndex: 1, originalText: '[Fuente 1]' },
      { type: 'text', value: '.' },
    ])
  })

  it('keeps an invalid citation literal before tokenizing the next valid citation', () => {
    expect(parseCitations('[Fuente 0] y [Fuente 2].')).toEqual([
      { type: 'text', value: '[Fuente 0] y ' },
      { type: 'citation', sourceIndex: 2, originalText: '[Fuente 2]' },
      { type: 'text', value: '.' },
    ])
  })

  it('keeps context provenance as a distinct non-documentary token', () => {
    expect(parseCitations('Superficie comprobada [contexto].')).toEqual([
      { type: 'text', value: 'Superficie comprobada ' },
      { type: 'context', originalText: '[contexto]' },
      { type: 'text', value: '.' },
    ])
  })

  it.each(['[undefined]', '[Fuente undefined]', '[null]', '[ Fuente null ]', '[NaN]'])(
    'removes the technical placeholder %s',
    (placeholder) => {
      expect(parseCitations(`Antes ${placeholder} después`)).toEqual([
        { type: 'text', value: 'Antes ' },
        { type: 'text', value: ' después' },
      ])
    }
  )

  it('does not destroy legitimate bracketed prose', () => {
    const content = 'El valor [orientativo] requiere revisión.'
    expect(parseCitations(content)).toEqual([{ type: 'text', value: content }])
  })
})

describe('document URL helpers', () => {
  it('builds an exact PDF page URL while preserving the query and replacing the hash', () => {
    expect(buildPdfPageUrl('https://example.test/norma.PDF?edition=2#section=4', '12')).toBe(
      'https://example.test/norma.PDF?edition=2#page=12'
    )
  })

  it('accepts page values received as numbers or strings', () => {
    expect(extractValidPageNumber(8)).toBe(8)
    expect(extractValidPageNumber(' 9 ')).toBe(9)
  })

  it('rejects invalid pages and unsafe or non-PDF destinations', () => {
    expect(buildPdfPageUrl('https://example.test/norma.pdf', 0)).toBeNull()
    expect(buildPdfPageUrl('https://example.test/norma.pdf', 'Página 4')).toBeNull()
    expect(buildPdfPageUrl('javascript:alert(1)', 4)).toBeNull()
    expect(buildPdfPageUrl('data:application/pdf;base64,abc', 4)).toBeNull()
    expect(buildPdfPageUrl('/norma.pdf', 4)).toBeNull()
    expect(buildPdfPageUrl('https://example.test/ficha.html', 4)).toBeNull()
  })

  it('accepts only direct HTTP(S) PDF destinations for embedded documents', () => {
    expect(buildPdfUrl('http://example.test/norma.pdf')).toBe('http://example.test/norma.pdf')
    expect(buildPdfUrl('https://example.test/ficha.html')).toBeNull()
  })

  it('opens a PDF without a valid page at its beginning', () => {
    expect(buildPdfUrl('https://example.test/norma.pdf?edition=2#old')).toBe(
      'https://example.test/norma.pdf?edition=2'
    )
  })

  it('rejects HTTP(S) URLs with credentials', () => {
    expect(buildSafeHttpUrl('https://user@example.test/norma.pdf')).toBeNull()
    expect(buildSafeHttpUrl('https://user:password@example.test/norma.pdf')).toBeNull()
  })
})
