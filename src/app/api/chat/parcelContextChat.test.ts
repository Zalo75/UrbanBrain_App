import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getExpedienteAccess: vi.fn(),
  loadAuthorizedParcelInputs: vi.fn(),
  insert: vi.fn(),
  select: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue(Object.assign(Promise.resolve([]), {
        limit: vi.fn().mockResolvedValue([]),
      })),
    }),
  }),
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
  db: { insert: mocks.insert, select: mocks.select },
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
import { getOfficialPlanningDocumentUrl } from '@/infrastructure/planning-knowledge/PlanningKnowledgeBase'
import { POST } from './route'

describe('visible source URL resolution', () => {
  it('resolves the audited P1 document by exact instrument and filename', () => {
    expect(getOfficialPlanningDocumentUrl('22221', '0060no011.pdf')).toBe(
      'https://siotuga.xunta.gal/siotuga/documentos/urbanismo/BETANZOS/documents/0060no011.pdf'
    )
  })

  it('does not fuzzy-match another instrument or filename', () => {
    expect(getOfficialPlanningDocumentUrl('22221', '0060no011-copia.pdf')).toBeUndefined()
    expect(getOfficialPlanningDocumentUrl('22231', '0060no011.pdf')).toBeUndefined()
  })
})

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

  it.each([
    ['¿Qué normativa has localizado para esta parcela?', true],
    ['¿Qué documentos normativos se aplican aquí?', true],
    ['Resume el planeamiento aplicable.', false],
  ])('usa la ruta documental adecuada para %s', async (message, expectsScopedRetrieval) => {
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
        planningArea: 'CASCAS',
        planningConflicts: ['La clasificación requiere revisión profesional.'],
      },
      latestDetectionRaw: {
        planning: {
          applicableInstruments: [{
            id: '22221',
            name: 'Normas subsidiarias',
            kind: 'NNSS',
            status: 'current',
            sourceUrl: 'https://example.invalid/22221',
          }],
          documents: [{
            id: '0060no011.pdf',
            instrumentId: '22221',
            title: 'Normas urbanísticas',
            sourceUrl: 'https://example.invalid/0060no011.pdf',
            binding: 'general',
            documentType: 'normative_text',
          }],
        },
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
        message,
      }),
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.completionCreate).toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenCalledWith(
      expectsScopedRetrieval ? 'match_normativa_chunks_scoped' : 'match_normativa_chunks',
      expect.objectContaining(
        expectsScopedRetrieval
          ? {
              filter_municipio_codigo: '15009',
              filter_document_names: ['0060no011.pdf'],
            }
          : { filter_municipio_codigo: '15009' }
      )
    )
    expect(payload.safety.decision).toBe('answer')
    expect(payload.safety.applicability).toBe('DETERMINADO')
    expect(payload.answer).not.toMatch(/pendiente de clasificación|no puedo determinar/i)
    expect(payload.answer).not.toMatch(/ocupación|edificabilidad|retranque|parcela mínima|frente mínimo|plantas|usos/i)

    const finalRequest = mocks.completionCreate.mock.calls
      .map(([request]) => request)
      .find((request) => request.messages?.[0]?.content?.includes('FRAGMENTOS AUTORIZADOS'))
    if (expectsScopedRetrieval) {
      expect(finalRequest.messages[0].content).toContain('MODO DOCUMENTAL ESTRICTO')
      expect(finalRequest.messages[0].content).toContain('No calcules, afirmes ni enumeres ocupación')
    } else {
      expect(finalRequest.messages[0].content).not.toContain('MODO DOCUMENTAL ESTRICTO')
    }
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

  it('no ejecuta búsqueda vectorial paramétrica sin un alcance normativo previo trazable', async () => {
    mocks.loadAuthorizedParcelInputs.mockResolvedValue({
      expediente: { id: 'expediente-org-a', orgId: 'org-a' },
      detected: {
        cadastralReference: '7709702NH4970N0001SZ',
        municipalityName: 'Culleredo',
        municipalityCode: '15031',
        locationSource: 'catastro',
        locationStatus: 'confirmed',
        locationConfidence: 'high',
        landClass: 'urbano',
        planningArea: 'LEDOÑO',
        planningCanAnswerConcreteParameters: true,
      },
      latestDetectionRaw: {
        status: 'confirmed',
        municipality: 'Culleredo',
        municipalityCode: '15031',
        planning: { status: 'determined', evidence: [], warnings: [] },
      },
      userMessages: [],
      constraints: [],
    })

    const response = await POST(new NextRequest('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expedienteId: 'expediente-org-a',
        message: '¿Cuál es el retranqueo aplicable?',
      }),
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.safety.decision).toBe('abstain')
    expect(payload.answer).toContain('alcance normativo previo')
    expect(mocks.embedContent).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it.each([
    '¿Cuál es el retranqueo aplicable?',
    '¿Cuál es la ocupación máxima permitida?',
  ])('mantiene la recuperación paramétrica acotada para %s', async (message) => {
    mocks.loadAuthorizedParcelInputs.mockResolvedValue({
      expediente: { id: 'expediente-org-a', orgId: 'org-a' },
      detected: {
        cadastralReference: '15009A01300255',
        municipalityName: 'Betanzos',
        municipalityCode: '15009',
        locationSource: 'catastro',
        locationStatus: 'confirmed',
        locationConfidence: 'high',
        landClass: 'urbano',
        planningArea: 'CASCAS',
        planningInstrument: 'Normas subsidiarias',
        planningSource: 'siotuga',
        planningStatus: 'vigente',
        planningApplicabilityStatus: 'determined',
        planningCanAnswerConcreteParameters: true,
        manualContext: {
          classification: 'urbano',
          area: 'CASCAS',
          ordinance: 'Ordenanza R4',
          provenance: 'manual',
          verification: 'technician_validated',
          recordedAt: '2026-07-29T10:00:00.000Z',
        },
      },
      latestDetectionRaw: {
        status: 'confirmed',
        municipality: 'Betanzos',
        municipalityCode: '15009',
        planning: {
          status: 'determined',
          applicableInstruments: [{
            id: '22221',
            name: 'Normas subsidiarias',
            kind: 'NNSS',
            status: 'current',
            sourceUrl: 'https://example.invalid/22221',
          }],
          documents: [{
            id: '0060no011.pdf',
            instrumentId: '22221',
            title: 'Normas urbanísticas',
            sourceUrl: 'https://example.invalid/0060no011.pdf',
            binding: 'general',
          }],
          evidence: [],
          warnings: [],
        },
      },
      userMessages: [],
      constraints: [],
    })
    mocks.abortSignal.mockResolvedValue({
      data: [{
        chunk_id: 'chunk-r4',
        texto: 'Ordenanza R4. El retranqueo lateral será de tres metros.',
        municipio_nombre: 'Betanzos',
        nombre_pdf: '0060no011.pdf',
      }],
      error: null,
    })

    const response = await POST(new NextRequest('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expedienteId: 'expediente-org-a',
        message,
      }),
    }))
    const payload = await response.json()

    expect(mocks.rpc).toHaveBeenCalledWith(
      'match_normativa_chunks_scoped',
      expect.objectContaining({
        filter_municipio_codigo: '15009',
        filter_document_names: ['0060no011.pdf'],
        filter_ordinance: 'Ordenanza R4',
      })
    )
    expect(payload.safety.decision).toBe('answer')
    expect(payload.sources[0]).toEqual(expect.objectContaining({
      source_index: 1,
      source_kind: 'normative_v1',
      nombre_pdf: '0060no011.pdf',
      fragmento_corto: expect.any(String),
      fragmento_completo: expect.stringContaining('Ordenanza R4'),
      official_url: 'https://siotuga.xunta.gal/siotuga/documentos/urbanismo/BETANZOS/documents/0060no011.pdf',
      truncated: false,
    }))
    expect(payload.sources[0]).not.toHaveProperty('original_path')
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({
      role: 'assistant',
      sources: payload.sources,
    }))
    expect(payload.answer).not.toMatch(/otro Ã¡mbito|otro \u00e1mbito/i)
  })

  it('reconoce hechos estructurados válidos cuando RAG no recupera normativa', async () => {
    mocks.loadAuthorizedParcelInputs.mockResolvedValue({
      expediente: { id: 'expediente-org-a', orgId: 'org-a' },
      detected: {
        cadastralReference: '7709702NH4970N0001SZ',
        municipalityName: 'Culleredo',
        municipalityCode: '15031',
        locationSource: 'catastro',
        locationStatus: 'confirmed',
        locationConfidence: 'high',
        planningInstrument: 'PXOM de Culleredo',
        planningArea: 'LEDOÑO',
        urbanisticFacts: {
          classification: { value: { code: 'SU', label: 'Suelo urbano' }, status: 'automatic_confirmed', confidence: 'high', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' },
          category: { value: { code: 'SUSC', label: 'Suelo urbano sin consolidar' }, status: 'automatic_confirmed', confidence: 'high', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' },
          consolidation: { status: 'manual_review_required', confidence: 'unknown', evidence: [], warnings: [], discrepancies: [], nextAction: 'review_official_sources' },
        },
      },
      userMessages: [],
      constraints: [{ name: 'Carreteras: zona de protección', source: 'ideg', confidence: 0.95, confirmed: true }],
    })

    const response = await POST(new NextRequest('http://localhost/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expedienteId: 'expediente-org-a', message: '¿Qué implica que la parcela esté clasificada como suelo urbano sin consolidar?' }),
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    // The pre-existing intent analyzer may invoke the model once; the safe fallback must not invoke the final responder.
    expect(mocks.completionCreate).toHaveBeenCalledTimes(1)
    expect(payload.answer).toContain('Suelo urbano sin consolidar (SUSC)')
    expect(payload.answer).not.toContain('Estado no determinado')
    expect(payload.answer).not.toContain('AFECCIONES CONFIRMADAS')
  })

  it('conserva una respuesta no numérica aunque no incluya cita documental', async () => {
    mocks.loadAuthorizedParcelInputs.mockResolvedValue({
      expediente: { id: 'expediente-org-a', orgId: 'org-a' },
      detected: {
        municipalityName: 'Culleredo', municipalityCode: '15031', locationSource: 'catastro', locationStatus: 'confirmed', locationConfidence: 'high', planningInstrument: 'PXOM de Culleredo',
        urbanisticFacts: {
          classification: { value: { code: 'SU', label: 'Suelo urbano' }, status: 'automatic_confirmed', confidence: 'high', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' },
          category: { value: { code: 'SUSC', label: 'Suelo urbano sin consolidar' }, status: 'automatic_confirmed', confidence: 'high', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' },
          consolidation: { status: 'manual_review_required', confidence: 'unknown', evidence: [], warnings: [], discrepancies: [], nextAction: 'review_official_sources' },
        },
      },
      userMessages: [], constraints: [],
    })
    mocks.abortSignal.mockResolvedValue({ data: [{ chunk_id: 'chunk-1', texto: 'Norma municipal vigente.', municipio_nombre: 'Culleredo', nombre_pdf: 'PXOM Culleredo' }], error: null })
    mocks.completionCreate.mockResolvedValue({ choices: [{ message: { content: 'La norma permite licencia directa.' } }] })

    const response = await POST(new NextRequest('http://localhost/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expedienteId: 'expediente-org-a', message: '¿Es posible solicitar licencia de obra mayor directamente?' }),
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.safety.decision).toBe('answer')
    expect(payload.answer).toContain('La norma permite licencia directa.')
  })

  it('keeps Betanzos parameter abstention without labelling general chunks as another area', async () => {
    mocks.loadAuthorizedParcelInputs.mockResolvedValue({
      expediente: {
        id: 'expediente-org-a',
        orgId: 'org-a',
        refCatastral: '15009A01300255',
        municipio: 'betanzos',
        urbanPlanningZone: 'CASCAS',
        planeamiento: 'Normas subsidiarias',
      },
      detected: {
        cadastralReference: '15009A01300255',
        municipalityName: 'Betanzos',
        municipalityCode: '15009',
        locationSource: 'catastro',
        locationStatus: 'confirmed',
        locationConfidence: 'high',
        landClass: 'nucleo_rural',
        planningArea: 'CASCAS',
        planningInstrument: 'Normas subsidiarias',
        planningSource: 'siotuga',
        planningStatus: 'vigente',
        planningCanAnswerConcreteParameters: false,
        manualContext: {
          ordinance: 'Ordenanza R4',
          provenance: 'manual',
          verification: 'technician_validated',
          recordedAt: '2026-08-05T12:00:00.000Z',
        },
      },
      latestDetectionRaw: {
        planning: {
          applicableInstruments: [{ id: '22221', status: 'current' }],
          documents: [{
            id: '0060no011.pdf',
            instrumentId: '22221',
            title: 'Normas urban\u00edsticas',
            sourceUrl: 'https://example.invalid/0060no011.pdf',
            binding: 'general',
          }],
        },
      },
      userMessages: [],
      constraints: [],
    })
    mocks.abortSignal.mockResolvedValue({
      data: [{
        chunk_id: 'chunk-general-retranqueo',
        texto: 'El recuado a linderos se regula en las determinaciones particulares.',
        municipio_nombre: 'Betanzos',
        nombre_pdf: '0060no011.pdf',
      }],
      error: null,
    })

    mocks.completionCreate.mockImplementation((req: any) => {
      const systemPrompt = req.messages[0].content
      if (systemPrompt.includes('Tu tarea es extraer la información solicitada')) {
        return Promise.resolve({
          choices: [{
            message: {
              content: `INFORMACIÓN LOCALIZADA
La normativa recuperada contiene las siguientes determinaciones relacionadas con la consulta:
- disposiciones sobre retranqueos, según documento [Fuente 1].

VERIFICACIÓN NECESARIA
La relación de estas determinaciones con el ámbito CASCAS o con la ordenanza aplicable todavía no está acreditada.

FUENTES
- [Fuente 1]: 0060no011.pdf, no identificada, enlace oficial no disponible.`
            }
          }],
        })
      }
      return Promise.resolve({
        choices: [{ message: { content: 'El documento vigente se identifica en la fuente [Fuente 1].' } }],
      })
    })

    const response = await POST(new NextRequest('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expedienteId: 'expediente-org-a',
        message: '\u00bfCu\u00e1nto hay que dejar de retranqueo en la parcela?',
      }),
    }))
    const payload = await response.json()

    expect(payload.safety.decision).toBe('answer')
    expect(payload.answer).toContain('disposiciones sobre retranqueos')
    expect(payload.answer).toContain('\u00e1mbito CASCAS')
    expect(payload.answer).not.toContain('No se ha recuperado evidencia documental suficiente')
    expect(payload.answer).not.toMatch(/otro \u00e1mbito/i)
    expect(payload.answer).not.toMatch(/\b\d+(?:[.,]\d+)?\s*m\b/i)
  })
})
