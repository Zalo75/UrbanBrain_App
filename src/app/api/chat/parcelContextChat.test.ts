import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getExpedienteAccess: vi.fn(),
  loadAuthorizedParcelInputs: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  embedContent: vi.fn(),
  rpc: vi.fn(),
  abortSignal: vi.fn(),
  completionCreate: vi.fn(),
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
    chat = { completions: { create: mocks.completionCreate } }
  },
}))

import { resetChatRequestGuardForTests } from '@/application/chat/chatRequestGuard'
import { POST } from './route'

describe('POST /api/chat parcel context boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetChatRequestGuardForTests()
    mocks.insert.mockReturnValue({ values: mocks.values })
    mocks.values.mockResolvedValue(undefined)
    mocks.embedContent.mockResolvedValue({ embedding: { values: new Array(768).fill(0.01) } })
    mocks.rpc.mockReturnValue({ abortSignal: mocks.abortSignal })
    mocks.abortSignal.mockResolvedValue({ data: [], error: null })
    mocks.completionCreate.mockResolvedValue({
      choices: [{ message: { content: 'El documento vigente se identifica en la fuente [Fuente 1].' } }],
    })
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
        municipalityCode: '15009',
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
      expect.objectContaining({ filter_municipio_codigo: '15009' })
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
        filter_municipio_codigo: '__urbanbrain_unconfirmed_municipality__',
      })
    )
  })

  it('mantiene las afecciones confirmadas de Betanzos aunque la clasificación sea conflictiva', async () => {
    mocks.loadAuthorizedParcelInputs.mockResolvedValue({
      expediente: { id: 'expediente-org-a', orgId: 'org-a' },
      detected: {
        cadastralReference: '15009A01300255',
        municipalityName: 'Betanzos',
        municipalityId: 'betanzos',
        municipalityCode: '15009',
        locationSource: 'catastro',
        locationStatus: 'confirmed',
        locationConfidence: 'high',
        planningApplicabilityStatus: 'conflict',
        planningCanAnswerConcreteParameters: false,
        planningConflicts: [
          'La parcela intersecta clases de suelo incompatibles y requiere validación geométrica.',
        ],
      },
      userMessages: [],
      constraints: [
        {
          name: 'Patrimonio cultural: contorno de protección',
          source: 'ideg',
          confidence: 0.95,
          confirmed: true,
        },
      ],
    })
    const request = new NextRequest('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expedienteId: 'expediente-org-a',
        message: 'Indica las afecciones y la edificabilidad aplicable.',
      }),
    })

    const response = await POST(request)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.answer).toContain('AFECCIONES CONFIRMADAS')
    expect(payload.answer).toContain('Patrimonio cultural: contorno de protección')
    expect(payload.answer).toContain('Fuente: ideg')
    expect(payload.answer).toContain('CLASIFICACIÓN Y PLANEAMIENTO')
    expect(payload.answer).toContain('COMPROBACIONES PENDIENTES')
    expect(payload.answer).not.toMatch(/edificabilidad\s*[:=]\s*\d/i)
  })

  it('responde una consulta documental aunque la clasificación de la parcela esté pendiente', async () => {
    mocks.loadAuthorizedParcelInputs.mockResolvedValue({
      expediente: { id: 'expediente-org-a', orgId: 'org-a' },
      detected: {
        cadastralReference: '15009A01300255',
        municipalityName: 'Betanzos',
        municipalityId: 'betanzos',
        municipalityCode: '15009',
        locationSource: 'catastro',
        locationStatus: 'confirmed',
        locationConfidence: 'high',
        planningApplicabilityStatus: 'conflict',
        planningCanAnswerConcreteParameters: false,
        planningConflicts: ['La clasificación requiere revisión profesional.'],
      },
      userMessages: [],
      constraints: [],
    })
    mocks.abortSignal.mockResolvedValue({
      data: [
        {
          chunk_id: 'chunk-1',
          texto: 'El documento de planeamiento general vigente es el PXOM.',
          municipio_nombre: 'Betanzos',
          nombre_pdf: 'PXOM de Betanzos',
        },
      ],
      error: null,
    })

    const response = await POST(new NextRequest('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expedienteId: 'expediente-org-a',
        message: 'Resume el documento de planeamiento recuperado.',
      }),
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.completionCreate).toHaveBeenCalled()
    expect(payload.safety.decision).toBe('answer')
    expect(payload.answer).not.toMatch(/pendiente de clasificación|no puedo determinar/i)
  })

  it('responde la parte disponible de una consulta mixta y se abstiene sólo del parámetro urbanístico', async () => {
    mocks.loadAuthorizedParcelInputs.mockResolvedValue({
      expediente: { id: 'expediente-org-a', orgId: 'org-a' },
      detected: {
        cadastralReference: '15009A01300255',
        municipalityName: 'Betanzos',
        municipalityId: 'betanzos',
        municipalityCode: '15009',
        locationSource: 'catastro',
        locationStatus: 'confirmed',
        locationConfidence: 'high',
        planningApplicabilityStatus: 'partial',
        planningCanAnswerConcreteParameters: false,
      },
      userMessages: [],
      constraints: [],
    })
    mocks.abortSignal.mockResolvedValue({
      data: [
        {
          chunk_id: 'chunk-1',
          texto: 'La parcela está afectada por la zona de protección de carreteras.',
          municipio_nombre: 'Betanzos',
          nombre_pdf: 'Informe sectorial oficial',
        },
      ],
      error: null,
    })
    mocks.completionCreate.mockResolvedValue({
      choices: [{
        message: {
          content: 'La parcela está afectada por la zona de protección de carreteras [Fuente 1]. No puedo determinar el retranqueo urbanístico sin clasificación y ordenanza confirmadas.',
        },
      }],
    })

    const response = await POST(new NextRequest('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expedienteId: 'expediente-org-a',
        message: 'Indica las afecciones y el retranqueo aplicable.',
      }),
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.safety.decision).toBe('answer')
    expect(payload.answer).toContain('zona de protección de carreteras')
    expect(payload.answer).toContain('No puedo determinar el retranqueo')
  })
})
