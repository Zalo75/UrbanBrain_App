import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getExpedienteAccess: vi.fn(),
  loadAuthorizedParcelInputs: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  embedContent: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('@/application/authorization/expedienteAccess', () => ({
  getExpedienteAccess: mocks.getExpedienteAccess,
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
      return { embedContent: mocks.embedContent }
    }
  },
  TaskType: { RETRIEVAL_QUERY: 'RETRIEVAL_QUERY' },
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ rpc: mocks.rpc })),
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
    mocks.insert.mockReturnValue({ values: mocks.values })
    mocks.values.mockResolvedValue(undefined)
    mocks.embedContent.mockResolvedValue({ embedding: { values: new Array(768).fill(0.01) } })
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    mocks.getExpedienteAccess.mockResolvedValue({
      ok: true,
      userId: 'user-org-a',
      orgId: 'org-a',
      expediente: { id: 'expediente-org-b', orgId: 'org-a' },
    })
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
    expect(await response.json()).toEqual({ error: 'Not found' })
    expect(mocks.loadAuthorizedParcelInputs).toHaveBeenCalledWith(
      'expediente-org-b',
      'user-org-a'
    )
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('filtra el RAG con el municipio oficial autorizado e ignora el municipio del cliente', async () => {
    mocks.loadAuthorizedParcelInputs.mockResolvedValue({
      expediente: {
        id: 'expediente-org-a',
        orgId: 'org-a',
        municipio: 'a_coruna',
        contextoValidadoPorTecnico: true,
      },
      detected: {
        municipalityName: 'Betanzos',
        municipalityId: 'betanzos',
        locationSource: 'catastro',
        locationStatus: 'confirmed',
        locationConfidence: 'high',
        planningCanAnswerConcreteParameters: false,
      },
      userMessages: [],
      constraints: [],
    })
    const request = new NextRequest('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expedienteId: 'expediente-org-a',
        message: 'Resume el planeamiento aplicable',
        municipio: 'municipio-manipulado',
      }),
    })

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith(
      'match_normativa_chunks',
      expect.objectContaining({ filter_municipio: 'Betanzos' })
    )
  })

  it('no abre la recuperación municipal cuando sólo existe un municipio manual', async () => {
    mocks.loadAuthorizedParcelInputs.mockResolvedValue({
      expediente: {
        id: 'expediente-org-a',
        orgId: 'org-a',
        municipio: 'a_coruna',
        contextoValidadoPorTecnico: true,
      },
      detected: {
        municipalityName: 'Municipio manual manipulado',
        manualContext: {
          municipality: 'Municipio manual manipulado',
          provenance: 'manual',
          verification: 'unverified',
          recordedAt: '2026-07-14T10:00:00.000Z',
        },
        reliability: {
          mode: 'manual_unverified',
          latestAttemptAt: '2026-07-14T10:00:00.000Z',
          usingPreviousOfficialContext: false,
          sourceChecks: [],
        },
        planningCanAnswerConcreteParameters: false,
      },
      userMessages: [],
      constraints: [],
    })
    const request = new NextRequest('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expedienteId: 'expediente-org-a',
        message: 'Resume el planeamiento aplicable',
        municipio: 'municipio-manipulado',
      }),
    })

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith(
      'match_normativa_chunks',
      expect.objectContaining({
        filter_municipio: '__urbanbrain_unconfirmed_municipality__',
      })
    )
  })
})
