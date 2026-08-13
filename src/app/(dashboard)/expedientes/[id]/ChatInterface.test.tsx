import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChatInterface } from './ChatInterface'

type ChatResponse = {
  ok: boolean
  json: () => Promise<unknown>
}

function deferredResponse() {
  let resolve!: (response: ChatResponse) => void
  const promise = new Promise<ChatResponse>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function configureScrollPosition({
  scrollHeight,
  scrollTop,
  clientHeight,
}: {
  scrollHeight: number
  scrollTop: number
  clientHeight: number
}) {
  const container = screen.getByTestId('chat-scroll-container')
  Object.defineProperties(container, {
    scrollHeight: { configurable: true, value: scrollHeight },
    scrollTop: { configurable: true, value: scrollTop, writable: true },
    clientHeight: { configurable: true, value: clientHeight },
  })
  return container
}

describe('ChatInterface autoscroll', () => {
  const scrollIntoView = vi.fn()

  beforeEach(() => {
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders context provenance humanly and hides historical technical placeholders', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => historyResponse([{
      role: 'assistant',
      content: 'Superficie 1790 m² [contexto]. [undefined] [Fuente undefined] [null] Valor [orientativo].',
      sources: [],
    }])))

    render(<ChatInterface expedienteId="exp-a" />)

    expect(await screen.findByText('Dato del expediente')).toBeTruthy()
    expect(screen.queryByText('[contexto]')).toBeNull()
    expect(screen.queryByText(/\[undefined\]|\[Fuente undefined\]|\[null\]/)).toBeNull()
    expect(screen.getByText(/Valor \[orientativo\]/)).toBeTruthy()
  })

  it('renders at most one context indicator for multiple historical markers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => historyResponse([{
      role: 'assistant',
      content: 'Referencia [contexto]. Dirección [contexto]. Superficie [contexto].',
      sources: [],
    }])))

    render(<ChatInterface expedienteId="exp-a" />)

    expect(await screen.findAllByText('Dato del expediente')).toHaveLength(1)
    expect(document.body.textContent).not.toContain('[contexto]')
  })

  it('leaves context silent under its explicit heading and keeps documentary citations interactive', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => historyResponse([{
      role: 'assistant',
      content: 'CONTEXTO DE PARCELA UTILIZADO\nCategoría SNRC [contexto].\nFundamento [Fuente 1]. Valor [orientativo].',
      sources: [source(1, 'https://example.test/norma.pdf', 4)],
    }])))

    render(<ChatInterface expedienteId="exp-a" />)

    expect(await screen.findByRole('link', { name: '[Fuente 1]' })).toBeTruthy()
    expect(screen.queryByText('Dato del expediente')).toBeNull()
    expect(document.body.textContent).not.toContain('[contexto]')
    expect(screen.getByText(/Valor \[orientativo\]/)).toBeTruthy()
  })

  it('silences every marker in the real multiline context block with a Markdown heading', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => historyResponse([{
      role: 'assistant',
      content: `CONCLUSIÓN
Respuesta prudente.

**CONTEXTO DE PARCELA UTILIZADO**

- Área de actuación efectiva: 1764,22 m² [contexto]
- Superficie de parcela catastral completa: 1790,46 m² [contexto]
- Referencia catastral: 123456789 [contexto]

FUNDAMENTO POR NIVEL NORMATIVO
Fundamento [Fuente 1].`,
      sources: [source(1, 'https://example.test/norma.pdf', 4)],
    }])))

    render(<ChatInterface expedienteId="exp-a" />)

    expect(await screen.findByRole('link', { name: '[Fuente 1]' })).toBeTruthy()
    expect(screen.queryByText('Dato del expediente')).toBeNull()
    expect(document.body.textContent).not.toContain('[contexto]')
  })

  it('loads the expanded source DTO from history while ignoring its legacy local path', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => historyResponse([{
      role: 'assistant',
      content: 'Consulta [Fuente 1].',
      sources: [source(1, 'D:\\corpus\\norma.pdf', 7, {
        source_kind: 'normative_v1',
        official_url: 'https://official.test/norma.pdf',
        fragmento_completo: 'Fragmento ampliado conservado.',
        truncated: false,
      })],
    }])))

    render(<ChatInterface expedienteId="exp-a" />)

    expect((await screen.findByRole('link', { name: '[Fuente 1]' })).getAttribute('href'))
      .toBe('https://official.test/norma.pdf#page=7')
    expect(document.body.textContent).not.toContain('D:\\corpus')
  })

  it('keeps the latest message visible while sending, loading and receiving the answer', async () => {
    const chatResponse = deferredResponse()
    vi.stubGlobal(
      'fetch',
      vi.fn((input: unknown) =>
        String(input).includes('/api/chat/history')
          ? Promise.resolve({ ok: true, json: async () => ({ history: [] }) })
          : chatResponse.promise
      )
    )

    render(<ChatInterface expedienteId="exp-a" />)
    scrollIntoView.mockClear()

    fireEvent.change(screen.getByPlaceholderText('Escribe tu consulta normativa...'), {
      target: { value: '¿Qué normativa se aplica?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar consulta' }))

    expect(screen.getByText('UrbanBrain está analizando la normativa...')).toBeTruthy()
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'end' })

    scrollIntoView.mockClear()
    await act(async () => {
      chatResponse.resolve({
        ok: true,
        json: async () => ({ answer: 'Respuesta normativa', sources: [] }),
      })
      await chatResponse.promise
    })

    expect(await screen.findByText('Respuesta normativa')).toBeTruthy()
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'end' })
  })

  it('stops following new content after manual upward scrolling and resumes from the button', async () => {
    const chatResponse = deferredResponse()
    vi.stubGlobal(
      'fetch',
      vi.fn((input: unknown) =>
        String(input).includes('/api/chat/history')
          ? Promise.resolve({ ok: true, json: async () => ({ history: [] }) })
          : chatResponse.promise
      )
    )

    render(<ChatInterface expedienteId="exp-a" />)
    const container = configureScrollPosition({
      scrollHeight: 1000,
      scrollTop: 100,
      clientHeight: 400,
    })

    fireEvent.change(screen.getByPlaceholderText('Escribe tu consulta normativa...'), {
      target: { value: 'Consulta' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar consulta' }))
    fireEvent.scroll(container)

    const latestButton = screen.getByRole('button', { name: 'Ir al último mensaje' })
    scrollIntoView.mockClear()

    await act(async () => {
      chatResponse.resolve({
        ok: true,
        json: async () => ({ answer: 'Respuesta pendiente', sources: [] }),
      })
      await chatResponse.promise
    })

    expect(await screen.findByText('Respuesta pendiente')).toBeTruthy()
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Ir al último mensaje' })).toBeTruthy()

    fireEvent.click(latestButton)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'end' })
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Ir al último mensaje' })).toBeNull()
    })
  })

  it('uses the 48 pixel threshold and re-enables autoscroll at the end', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ history: [] }) }))
    )

    render(<ChatInterface expedienteId="exp-a" />)
    const container = configureScrollPosition({
      scrollHeight: 1000,
      scrollTop: 551,
      clientHeight: 400,
    })

    fireEvent.scroll(container)
    expect(screen.getByRole('button', { name: 'Ir al último mensaje' })).toBeTruthy()

    container.scrollTop = 552
    fireEvent.scroll(container)
    expect(screen.queryByRole('button', { name: 'Ir al último mensaje' })).toBeNull()
  })
})

function source(
  sourceIndex: number,
  originalPath: string,
  page: string | number = 1,
  overrides: Record<string, unknown> = {}
) {
  return {
    chunk_id: `chunk-${sourceIndex}`,
    municipio_nombre: 'A Coruña',
    nombre_pdf: `Documento ${sourceIndex}`,
    source_index: sourceIndex,
    original_path: originalPath,
    pagina_detectada: page,
    fragmento_corto: `Fragmento ${sourceIndex}`,
    ...overrides,
  }
}

function historyResponse(history: unknown[]) {
  return { ok: true, json: async () => ({ history }) }
}

async function renderSourceDetail(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal('fetch', vi.fn(async () => historyResponse([
    {
      role: 'assistant',
      content: 'Consulta [Fuente 1].',
      sources: [source(1, 'https://example.test/norma.pdf', 3, overrides)],
    },
  ])))

  render(<ChatInterface expedienteId="exp-a" />)
  fireEvent.click(await screen.findByRole('link', { name: '[Fuente 1]' }))
}

function stubClipboard(clipboard: unknown) {
  const mockedNavigator = Object.create(navigator)
  Object.defineProperty(mockedNavigator, 'clipboard', { configurable: true, value: clipboard })
  vi.stubGlobal('navigator', mockedNavigator)
}

function getSourcePanelScrollContainer() {
  const panelHeading = screen.getByText('Documentos de Referencia')
  const scrollContainer = panelHeading.parentElement?.nextElementSibling
  if (!(scrollContainer instanceof HTMLElement)) {
    throw new Error('No se encontró el panel desplazable de fuentes')
  }
  return scrollContainer
}

describe('ChatInterface citations', () => {
  beforeEach(() => {
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('keeps sources scoped to the historical message that contains the citation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => historyResponse([
      {
        role: 'assistant',
        content: 'Primera [Fuente 1].',
        sources: [source(1, 'https://example.test/first.pdf', 3)],
      },
      {
        role: 'assistant',
        content: 'Segunda [Fuente 1].',
        sources: [source(1, 'https://example.test/second.pdf', 8)],
      },
    ])))

    render(<ChatInterface expedienteId="exp-a" />)

    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: '[Fuente 1]' })).toHaveLength(2)
    })
    const citations = screen.getAllByRole('link', { name: '[Fuente 1]' })
    expect(citations).toHaveLength(2)
    expect(citations[0].getAttribute('href')).toBe('https://example.test/first.pdf#page=3')
    expect(citations[1].getAttribute('href')).toBe('https://example.test/second.pdf#page=8')
  })

  it('keeps an earlier response unchanged when a new response has its own source', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: unknown) =>
        String(input).includes('/api/chat/history')
          ? Promise.resolve(historyResponse([
              {
                role: 'assistant',
                content: 'Anterior [Fuente 1].',
                sources: [source(1, 'https://example.test/previous.pdf', 2)],
              },
            ]))
          : Promise.resolve({
              ok: true,
              json: async () => ({
                answer: 'Nueva [Fuente 1].',
                sources: [source(1, 'https://example.test/new.pdf?edition=2#old', '9')],
              }),
            })
      )
    )

    render(<ChatInterface expedienteId="exp-a" />)
    expect((await screen.findByRole('link', { name: '[Fuente 1]' })).getAttribute('href')).toBe(
      'https://example.test/previous.pdf#page=2'
    )

    fireEvent.change(screen.getByPlaceholderText('Escribe tu consulta normativa...'), {
      target: { value: 'Nueva consulta' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar consulta' }))

    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: '[Fuente 1]' })).toHaveLength(2)
    })
    const citations = screen.getAllByRole('link', { name: '[Fuente 1]' })
    expect(citations.map((citation) => citation.getAttribute('href'))).toEqual([
      'https://example.test/previous.pdf#page=2',
      'https://example.test/new.pdf?edition=2#page=9',
    ])
  })

  it('normalizes response sources, retaining only the first duplicate source_index', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: unknown) =>
        String(input).includes('/api/chat/history')
          ? Promise.resolve(historyResponse([]))
          : Promise.resolve({
              ok: true,
              json: async () => ({
                answer: 'Respuesta [Fuente 1].',
                sources: [
                  source(1, 'https://example.test/first.pdf', 4),
                  source(1, 'https://example.test/duplicate.pdf', 7),
                ],
              }),
            })
      )
    )

    render(<ChatInterface expedienteId="exp-a" />)
    fireEvent.change(screen.getByPlaceholderText('Escribe tu consulta normativa...'), {
      target: { value: 'Consulta' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar consulta' }))

    expect((await screen.findByRole('link', { name: '[Fuente 1]' })).getAttribute('href')).toBe(
      'https://example.test/first.pdf#page=4'
    )
  })

  it('does not create misleading links for invalid citations or messages without sources', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => historyResponse([
      {
        role: 'assistant',
        content: 'Con fuente [Fuente 1].',
        sources: [source(1, 'https://example.test/available.pdf', 5)],
      },
      {
        role: 'assistant',
        content: 'Sin fuente [Fuente 1] y [Fuente 2].',
      },
      {
        role: 'assistant',
        content: 'Índice inválido [Fuente 0].',
        sources: [source(1, 'https://example.test/other.pdf', 6)],
      },
    ])))

    render(<ChatInterface expedienteId="exp-a" />)

    const citations = await screen.findAllByRole('link', { name: '[Fuente 1]' })
    expect(citations).toHaveLength(1)
    expect(citations[0].getAttribute('href')).toBe('https://example.test/available.pdf#page=5')
    expect(screen.getByText('[Fuente 2]')).toHaveProperty('tagName', 'SPAN')
    expect(screen.getByText('Índice inválido [Fuente 0].')).toBeTruthy()
  })

  it('gives repeated citations to one source the same safe destination', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => historyResponse([
      {
        role: 'assistant',
        content: '[Fuente 1] y de nuevo [Fuente 1].',
        sources: [source(1, 'https://example.test/repeated.pdf?version=1#old', 11)],
      },
    ])))

    render(<ChatInterface expedienteId="exp-a" />)

    const citations = await screen.findAllByRole('link', { name: '[Fuente 1]' })
    expect(citations).toHaveLength(2)
    expect(citations.map((citation) => citation.getAttribute('href'))).toEqual([
      'https://example.test/repeated.pdf?version=1#page=11',
      'https://example.test/repeated.pdf?version=1#page=11',
    ])
  })

  it('leaves the panel empty when the latest assistant response has no sources', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => historyResponse([
      {
        role: 'assistant',
        content: 'Anterior [Fuente 1].',
        sources: [source(1, 'https://example.test/previous.pdf', 2)],
      },
      { role: 'assistant', content: 'Respuesta reciente sin fuentes.' },
    ])))

    render(<ChatInterface expedienteId="exp-a" />)

    expect(await screen.findByText('Respuesta reciente sin fuentes.')).toBeTruthy()
    expect(screen.getByText(/se mostrarán los fragmentos/i)).toBeTruthy()
    expect(screen.queryByText('Documento 1')).toBeNull()
  })

  it('opens an exact PDF citation without cancelling navigation and selects its source', async () => {
    const open = vi.fn()
    vi.stubGlobal('open', open)
    vi.stubGlobal('fetch', vi.fn(async () => historyResponse([
      {
        role: 'assistant',
        content: 'Consulta [Fuente 1].',
        sources: [source(1, 'https://example.test/norma.pdf?edition=2#old', 4)],
      },
    ])))

    render(<ChatInterface expedienteId="exp-a" />)

    const citation = await screen.findByRole('link', { name: '[Fuente 1]' })
    expect(citation.getAttribute('href')).toBe('https://example.test/norma.pdf?edition=2#page=4')
    expect(citation.getAttribute('target')).toBe('_blank')
    expect(citation.getAttribute('rel')).toBe('noopener noreferrer')
    expect(citation.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))).toBe(true)

    const viewer = await screen.findByTitle('Visor PDF Documento 1')
    expect(viewer.getAttribute('src')).toBe('https://example.test/norma.pdf?edition=2#page=4')
    fireEvent.click(screen.getByRole('button', { name: 'Abrir documento original' }))
    expect(open).toHaveBeenCalledWith(
      'https://example.test/norma.pdf?edition=2#page=4',
      '_blank',
      'noopener,noreferrer'
    )
  })

  it('returns the source panel to the top when the active source changes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => historyResponse([
      {
        role: 'assistant',
        content: 'Primera [Fuente 1] y segunda [Fuente 2].',
        sources: [
          source(1, 'https://example.test/one.pdf', 2),
          source(2, 'https://example.test/two.pdf', 7),
        ],
      },
    ])))

    render(<ChatInterface expedienteId="exp-a" />)
    fireEvent.click(await screen.findByRole('link', { name: '[Fuente 1]' }))

    const firstViewer = await screen.findByTitle('Visor PDF Documento 1')
    const sourcePanel = getSourcePanelScrollContainer()
    expect(sourcePanel.className).toContain('overflow-y-auto')
    expect(sourcePanel.contains(firstViewer)).toBe(true)

    sourcePanel.scrollTop = 240
    expect(sourcePanel.scrollTop).toBe(240)
    fireEvent.click(screen.getByRole('link', { name: '[Fuente 2]' }))

    const secondViewer = await screen.findByTitle('Visor PDF Documento 2')
    expect(sourcePanel.contains(secondViewer)).toBe(true)
    expect(screen.queryByTitle('Visor PDF Documento 1')).toBeNull()
    await waitFor(() => {
      expect(sourcePanel.scrollTop).toBe(0)
    })
  })

  it('does not reset the source panel scroll for an action that keeps the active source', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard({ writeText })
    await renderSourceDetail()

    const viewer = await screen.findByTitle('Visor PDF Documento 1')
    const sourcePanel = getSourcePanelScrollContainer()
    expect(sourcePanel.contains(viewer)).toBe(true)

    sourcePanel.scrollTop = 180
    fireEvent.click(screen.getByRole('button', { name: 'Copiar fragmento' }))

    expect(await screen.findByText('Fragmento copiado.')).toBeTruthy()
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(sourcePanel.scrollTop).toBe(180)
  })

  it('opens a PDF without a valid page from its beginning and makes source cards keyboard-accessible buttons', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => historyResponse([
      {
        role: 'assistant',
        content: 'Consulta [Fuente 1].',
        sources: [source(1, 'https://example.test/norma.pdf?edition=2#old', 'Página 4')],
      },
    ])))

    render(<ChatInterface expedienteId="exp-a" />)

    const citation = await screen.findByRole('link', { name: '[Fuente 1]' })
    expect(citation.getAttribute('href')).toBe('https://example.test/norma.pdf?edition=2')
    const card = screen.getByRole('button', { name: /Fuente 1/i })
    expect(card.tagName).toBe('BUTTON')
    fireEvent.keyDown(card, { key: 'Enter' })
    fireEvent.click(card)
    expect(await screen.findByText(/Página no determinada/i)).toBeTruthy()
    expect(screen.getByTitle('Visor PDF Documento 1').getAttribute('src')).toBe(
      'https://example.test/norma.pdf?edition=2'
    )
  })

  it('opens an HTTP(S) non-PDF citation as an external document and leaves invalid destinations unlinked', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => historyResponse([
      {
        role: 'assistant',
        content: 'Ficha [Fuente 1] e inválida [Fuente 2].',
        sources: [
          source(1, 'https://example.test/ficha.html', 6),
          source(2, 'javascript:alert(1)', 3),
        ],
      },
    ])))

    render(<ChatInterface expedienteId="exp-a" />)

    const externalCitation = await screen.findByRole('link', { name: '[Fuente 1]' })
    expect(externalCitation.getAttribute('href')).toBe('https://example.test/ficha.html')
    expect(screen.queryByRole('link', { name: '[Fuente 2]' })).toBeNull()
    fireEvent.click(externalCitation)
    expect(await screen.findByText(/ficha o documento externo/i)).toBeTruthy()
    expect(screen.queryByTitle('Visor PDF Documento 1')).toBeNull()
    expect(screen.getByRole('button', { name: 'Abrir documento original' })).toBeTruthy()
  })

  it('opens source evidence without a URL and never exposes a local ingestion path', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => historyResponse([{
      role: 'assistant',
      content: 'Consulta [Fuente 1].',
      sources: [source(1, 'D:\\corpus\\0060no011.pdf', 4, {
        fragmento_completo: 'Evidencia completa disponible sin enlace externo.',
      })],
    }])))

    render(<ChatInterface expedienteId="exp-a" />)

    const citation = await screen.findByRole('button', { name: '[Fuente 1]' })
    expect(screen.queryByRole('link', { name: '[Fuente 1]' })).toBeNull()
    fireEvent.click(citation)
    expect(await screen.findByText(/Evidencia completa disponible/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Abrir documento original' })).toBeNull()
    expect(screen.queryByText(/Enlace oficial no disponible/i)).toBeNull()
    expect(document.body.textContent).not.toContain('D:\\corpus')
  })

  it('shows a trimmed complete fragment before the short fragment', async () => {
    await renderSourceDetail({
      fragmento_completo: '  Texto completo de la fuente.\n',
      fragmento_corto: 'Texto abreviado.',
    })

    const recoveredText = await screen.findByText(/Texto recuperado:/)
    expect(recoveredText.textContent).toBe('Texto recuperado: “Texto completo de la fuente.”')
    expect(recoveredText.className).not.toContain('line-clamp')
    expect(recoveredText.className).toContain('whitespace-pre-wrap')
    expect(screen.queryByText(/Texto abreviado/)).toBeNull()
  })

  it.each([
    ['ausente', {}],
    ['nulo', { fragmento_completo: null }],
    ['vacío', { fragmento_completo: '' }],
    ['sólo espacios y saltos', { fragmento_completo: '  \n  ' }],
  ])('falls back to the short fragment when the complete fragment is %s', async (_case, overrides) => {
    await renderSourceDetail({ fragmento_corto: 'Fragmento corto normalizado.', ...overrides })

    const recoveredText = await screen.findByText(/Texto recuperado:/)
    expect(recoveredText.textContent).toBe('Texto recuperado: “Fragmento corto normalizado.”')
  })

  it.each(['null', 'undefined'])('does not expose the technical marker "%s" as a fragment', async (marker) => {
    await renderSourceDetail({
      fragmento_completo: `  ${marker}  `,
      fragmento_corto: 'Fragmento corto seguro.',
    })

    const recoveredText = await screen.findByText(/Texto recuperado:/)
    expect(recoveredText.textContent).toBe('Texto recuperado: “Fragmento corto seguro.”')
    expect(screen.queryByText(marker)).toBeNull()
  })

  it.each([
    'Artículo 12.3',
    'artículo único',
    'disposición adicional',
    'normas urbanísticas',
    'ordenanza general',
  ])('shows the detected normative reference "%s" without semantic heuristics', async (reference) => {
    await renderSourceDetail({ titulo_detectado: `  ${reference}  ` })

    expect(await screen.findByText('Referencia detectada:')).toBeTruthy()
    expect(screen.getByText(reference)).toBeTruthy()
  })

  it.each([
    ['nulo', null],
    ['vacío', ''],
    ['espacios', '   '],
    ['N/A', 'N/A'],
    ['ninguno', 'ninguno'],
    ['sin determinar', 'sin determinar'],
    ['guion', '-'],
  ])('hides the detected reference block for %s', async (_case, reference) => {
    await renderSourceDetail({ titulo_detectado: reference })

    expect(screen.queryByText('Referencia detectada:')).toBeNull()
  })

  it('shows a prudent automatic extraction warning in the source detail', async () => {
    await renderSourceDetail()

    expect(await screen.findByText(/Texto extraído automáticamente/)).toBeTruthy()
    expect(screen.getByText(/Verifique siempre el documento original/)).toBeTruthy()
  })

  it('shows an honest fallback when neither fragment contains text', async () => {
    await renderSourceDetail({ fragmento_completo: ' \n ', fragmento_corto: ' undefined ' })

    expect(await screen.findByText('Fragmento no disponible.')).toBeTruthy()
    expect(screen.queryByText('null')).toBeNull()
    expect(screen.queryByText('undefined')).toBeNull()
  })

  it('copies the complete fragment and then a citation with only normalized metadata', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard({ writeText })
    await renderSourceDetail({
      fragmento_completo: '  Texto completo.  ',
      fragmento_corto: 'Texto corto.',
      nombre_pdf: '  Normas.pdf  ',
      titulo_detectado: '  Artículo 5  ',
      pagina_detectada: 'Página 4',
      original_path: 'https://example.test/norma.pdf',
    })

    const fragmentButton = await screen.findByRole('button', { name: 'Copiar fragmento' })
    const citationButton = screen.getByRole('button', { name: 'Copiar con cita' })
    expect(fragmentButton.getAttribute('type')).toBe('button')
    expect(citationButton.getAttribute('type')).toBe('button')

    fireEvent.click(fragmentButton)
    expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Fragmento copiado.')
    expect(writeText).toHaveBeenLastCalledWith('Texto completo.')

    fireEvent.click(citationButton)
    expect(await screen.findByText('Cita copiada.')).toHaveProperty('textContent', 'Cita copiada.')
    expect(writeText).toHaveBeenLastCalledWith(
      '«Texto completo.»\n\nFuente: Normas.pdf\nReferencia detectada: Artículo 5\nPágina: 4\nOrigen oficial: https://example.test/norma.pdf'
    )
  })

  it('falls back to the short fragment when copying', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard({ writeText })
    await renderSourceDetail({ fragmento_completo: ' null ', fragmento_corto: '  Texto corto.  ' })

    fireEvent.click(await screen.findByRole('button', { name: 'Copiar fragmento' }))
    await screen.findByText('Fragmento copiado.')
    expect(writeText).toHaveBeenCalledWith('Texto corto.')
  })

  it.each([
    ['Clipboard API ausente', undefined],
    ['writeText ausente', {}],
  ])('shows accessible feedback when %s', async (_case, clipboard) => {
    stubClipboard(clipboard)
    await renderSourceDetail()

    fireEvent.click(await screen.findByRole('button', { name: 'Copiar fragmento' }))
    const status = await screen.findByRole('status')
    expect(status.textContent).toBe('No se pudo copiar porque el portapapeles no está disponible.')
    expect(status.getAttribute('aria-live')).toBe('polite')
  })

  it('handles a rejected clipboard write without an unhandled promise', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('Permission denied'))
    stubClipboard({ writeText })
    await renderSourceDetail()

    fireEvent.click(await screen.findByRole('button', { name: 'Copiar fragmento' }))
    expect((await screen.findByRole('status')).textContent).toMatch(/No se pudo copiar/)
    expect(writeText).toHaveBeenCalledTimes(1)
  })

  it('disables both copy buttons and does not write when no fragment exists', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard({ writeText })
    await renderSourceDetail({ fragmento_completo: ' null ', fragmento_corto: ' undefined ' })

    const fragmentButton = await screen.findByRole('button', { name: 'Copiar fragmento' })
    const citationButton = screen.getByRole('button', { name: 'Copiar con cita' })
    expect((fragmentButton as HTMLButtonElement).disabled).toBe(true)
    expect((citationButton as HTMLButtonElement).disabled).toBe(true)
    expect((await screen.findByRole('status')).textContent).toBe('No hay un fragmento disponible para copiar.')

    fireEvent.click(fragmentButton)
    fireEvent.click(citationButton)
    expect(writeText).not.toHaveBeenCalled()
  })

  it('copies only the active source', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard({ writeText })
    vi.stubGlobal('fetch', vi.fn(async () => historyResponse([
      {
        role: 'assistant',
        content: 'Primera [Fuente 1] y segunda [Fuente 2].',
        sources: [
          source(1, 'https://example.test/one.pdf', 1, { fragmento_completo: 'Fuente activa uno.' }),
          source(2, 'https://example.test/two.pdf', 2, { fragmento_completo: 'Fuente activa dos.' }),
        ],
      },
    ])))

    render(<ChatInterface expedienteId="exp-a" />)
    const citations = await screen.findAllByRole('link')
    fireEvent.click(citations[1])
    fireEvent.click(await screen.findByRole('button', { name: 'Copiar fragmento' }))
    await screen.findByText('Fragmento copiado.')

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith('Fuente activa dos.')
  })

  it('replaces error feedback with success on consecutive attempts', async () => {
    const writeText = vi.fn()
      .mockRejectedValueOnce(new Error('Denied'))
      .mockResolvedValueOnce(undefined)
    stubClipboard({ writeText })
    await renderSourceDetail()

    const fragmentButton = await screen.findByRole('button', { name: 'Copiar fragmento' })
    fireEvent.click(fragmentButton)
    expect((await screen.findByRole('status')).textContent).toMatch(/No se pudo copiar/)

    fireEvent.click(fragmentButton)
    expect((await screen.findByText('Fragmento copiado.')).textContent).toBe('Fragmento copiado.')
    expect(screen.queryByText(/Comprueba los permisos/)).toBeNull()
    expect(writeText).toHaveBeenCalledTimes(2)
  })
})
