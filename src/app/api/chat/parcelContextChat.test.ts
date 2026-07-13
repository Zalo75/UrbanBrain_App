import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getUserId: vi.fn(),
  loadAuthorizedParcelInputs: vi.fn(),
  insert: vi.fn(),
}))

vi.mock('@/infrastructure/auth', () => ({
  authProvider: { getUserId: mocks.getUserId },
}))
vi.mock('@/infrastructure/db/parcelContextRepository', () => ({
  loadAuthorizedParcelInputs: mocks.loadAuthorizedParcelInputs,
}))
vi.mock('@/infrastructure/db/client', () => ({
  db: { insert: mocks.insert },
}))
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return { embedContent: vi.fn() }
    }
  },
  TaskType: { RETRIEVAL_QUERY: 'RETRIEVAL_QUERY' },
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ rpc: vi.fn() })),
}))
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: vi.fn() } }
  },
}))

import { POST } from './route'

describe('POST /api/chat parcel context boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUserId.mockResolvedValue('user-org-a')
    mocks.loadAuthorizedParcelInputs.mockResolvedValue(null)
  })

  it('no escribe ni revela contexto del expediente B al usuario de la organización A', async () => {
    const request = new NextRequest('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expedienteId: 'expediente-org-b',
        message: 'Dame la edificabilidad',
        municipio: 'municipio-manipulado',
      }),
    })

    const response = await POST(request)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Expediente not found' })
    expect(mocks.loadAuthorizedParcelInputs).toHaveBeenCalledWith(
      'expediente-org-b',
      'user-org-a'
    )
    expect(mocks.insert).not.toHaveBeenCalled()
  })
})
