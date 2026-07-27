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
