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
  from: vi.fn(),
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
  createClient: vi.fn(() => ({ rpc: mocks.rpc, from: mocks.from })),
}))
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: mocks.completionCreate } }
  },
}))

import { resetChatRequestGuardForTests } from '@/application/chat/chatRequestGuard'
import { clearMunicipalCorpusAvailabilityCache } from '@/application/chat/municipalCorpusAvailability'
import { getOfficialPlanningDocumentUrl } from '@/infrastructure/planning-knowledge/PlanningKnowledgeBase'
import { POST } from './route'
import { EXACT_CHUNK_SELECT, hasSpecificNormativeEvidence } from './routeInternals'

describe('pre-LLM territorial conflict gate', () => {
  const scope = { instrumentId: '27387', identityId: '27387:ordinance:R-2' } as any
  const evidence = {
    id: '939bc9fc3898b3ce_00218',
    parentInstrument: '27387',
    identityId: '27387:ordinance:R-2',
    evidenceSpecificity: 'SPECIFIC',
    normativeReferences: [{ chunkIds: ['939bc9fc3898b3ce_00218'] }],
  } as any

  it('recognizes specific canonical evidence despite a territorial conflict', () => {
    expect(hasSpecificNormativeEvidence([evidence], scope)).toBe(true)
  })

  it('does not treat missing regime validation alone as missing evidence', () => {
    expect(hasSpecificNormativeEvidence([evidence], scope)).toBe(true)
  })

  it('rejects evidence from another instrument', () => {
    expect(hasSpecificNormativeEvidence([{ ...evidence, parentInstrument: 'other' }], scope)).toBe(false)
  })

  it('rejects non-specific fallback evidence', () => {
    expect(hasSpecificNormativeEvidence([{ ...evidence, evidenceSpecificity: 'NON_SPECIFIC' }], scope)).toBe(false)
  })

  it('rejects evidence with no canonical identity or reference link', () => {
    expect(hasSpecificNormativeEvidence([{ ...evidence, identityId: null }], scope)).toBe(false)
    expect(hasSpecificNormativeEvidence([{ ...evidence, normativeReferences: [] }], scope)).toBe(false)
  })
})

describe('canonical exact chunk projection', () => {
  it('uses only deployed normativa_chunks columns and preserves candidate fields', () => {
    expect(EXACT_CHUNK_SELECT).toContain('chunk_id')
    expect(EXACT_CHUNK_SELECT).toContain('embedding')
    expect(EXACT_CHUNK_SELECT).not.toContain('pagina_detectada')
  })
})

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
    clearMunicipalCorpusAvailabilityCache()
    mocks.insert.mockReturnValue({ values: mocks.values })
    mocks.values.mockResolvedValue(undefined)
    mocks.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: [{ id: 'sample-chunk-id' }], error: null }),
        }),
      }),
    })
    mocks.embedContent.mockResolvedValue({ embedding: { values: new Array(768).fill(0.01) } })
    mocks.rpc.mockReturnValue({ abortSignal: mocks.abortSignal })
    mocks.abortSignal.mockResolvedValue({ data: [], error: null })
    mocks.completionCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ answerMode: 'definitive', claims: [{ id: 'claim_1', type: 'normative_fact', text: "El documento vigente se identifica en la fuente [Fuente 1].", sourceRefs: [1], appliesToParcel: 'unknown', numericTokens: [] }], missingFacts: [] }) } }],
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

    const documentaryPromptSeen = mocks.completionCreate.mock.calls
      .map(([request]) => String(request?.messages?.[0]?.content ?? ''))
      .some((content) => content.includes('MODO DOCUMENTAL ESTRICTO'))
    if (expectsScopedRetrieval) {
      expect(documentaryPromptSeen).toBe(true)
    } else {
      expect(documentaryPromptSeen).toBe(false)
    }
  })

  it('propaga una ordenanza USER_CONFIRMED al chat y la usa para acotar el retrieval', async () => {
    mocks.loadAuthorizedParcelInputs.mockResolvedValue({
      expediente: { id: 'expediente-org-a', orgId: 'org-a' },
      detected: {
        cadastralReference: '15082A01000001',
        municipalityName: 'Teo',
        municipalityCode: '15082',
        locationSource: 'catastro',
        locationStatus: 'confirmed',
        locationConfidence: 'high',
        planningInstrument: 'Normas subsidiarias',
        planningSource: 'siotuga',
        planningStatus: 'vigente',
        planningCanAnswerConcreteParameters: true,
        ordinanceCandidates: [{
          identity: 'R-2',
          instrumentId: 'teo-plan',
          semanticDimension: 'ordinance',
          provenance: ['official:wms', 'official:legend'],
          confidence: 'high',
          status: 'user_confirmed',
          confirmationSource: 'user',
        }],
        ordinanceResolution: {
          status: 'USER_CONFIRMED',
          identity: { code: 'R-2', label: 'R-2' },
          confidence: 'high',
          provenance: ['official:wms', 'official:legend'],
          confirmationSource: 'user',
          confirmedByUser: true,
        },
        ordinanceDetermination: {
          technician: {
            value: 'R-2',
            origin: 'technician_selection',
            source: 'manual',
            verification: 'unverified',
          },
        },
      },
      latestDetectionRaw: {
        status: 'confirmed',
        municipality: 'Teo',
        municipalityCode: '15082',
        planning: {
          status: 'determined',
          applicableInstruments: [{
            id: 'teo-plan',
            name: 'Normas subsidiarias',
            kind: 'NNSS',
            status: 'current',
            sourceUrl: 'https://example.invalid/teo-plan',
          }],
          documents: [{
            id: 'r2.pdf',
            instrumentId: 'teo-plan',
            title: 'Ordenanza R-2',
            sourceUrl: 'https://example.invalid/r2.pdf',
            binding: 'general',
            documentType: 'ordinance',
          }],
          ordinanceResolution: {
            status: 'USER_CONFIRMED',
            identity: { code: 'R-2', label: 'R-2' },
            confidence: 'high',
            provenance: ['official:wms', 'official:legend'],
            confirmationSource: 'user',
            confirmedByUser: true,
          },
          ordinanceCandidates: [{
            identity: 'R-2',
            instrumentId: 'teo-plan',
            semanticDimension: 'ordinance',
            provenance: ['official:wms', 'official:legend'],
            confidence: 'high',
            status: 'user_confirmed',
            confirmationSource: 'user',
          }],
          evidence: [],
          warnings: [],
        },
        candidates: [], evidence: [], warnings: [], conflicts: [],
        confidence: 'high', inputMethod: 'cadastral_reference',
        resolvedAt: '2026-08-27T10:00:00.000Z',
        affects: { analysisGeometry: 'parcel', detected: [], canRuleOutUndetectedAffects: false, warnings: [] },
      },
      userMessages: [],
      constraints: [],
    })
    mocks.abortSignal.mockResolvedValue({
      data: [{
        chunk_id: 'r2-chunk',
        texto: 'La Ordenanza R-2 establece las condiciones urbanísticas.',
        municipio_nombre: 'Teo',
        nombre_pdf: 'r2.pdf',
        original_path: 'https://example.invalid/r2.pdf',
      }],
      error: null,
    })

    const response = await POST(new NextRequest('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expedienteId: 'expediente-org-a',
        message: '¿Cuál es la ordenanza aplicable a esta parcela y qué condiciones urbanísticas establece para ella? Cita las fuentes.',
      }),
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith(
      'match_normativa_chunks_scoped',
      expect.objectContaining({
        filter_municipio_codigo: '15082',
        filter_ordinance: 'R-2',
      })
    )
    const llmRequests = mocks.completionCreate.mock.calls.map(([request]) => JSON.stringify(request ?? {})).join('\n')
    expect(llmRequests).toContain('R-2')
    expect(payload.answer).not.toContain('Faltan estos datos: ordenanza o zona normativa aplicable')
  })

  it('no convierte un timeout del filtro de ordenanza en un 500 ni en una búsqueda municipal amplia', async () => {
    mocks.loadAuthorizedParcelInputs.mockResolvedValue({
      expediente: { id: 'expediente-org-a', orgId: 'org-a' },
      detected: {
        cadastralReference: '15082A01000001',
        municipalityName: 'Teo',
        municipalityCode: '15082',
        locationSource: 'catastro',
        locationStatus: 'confirmed',
        locationConfidence: 'high',
        planningInstrument: 'Normas subsidiarias',
        planningSource: 'siotuga',
        planningStatus: 'vigente',
        planningCanAnswerConcreteParameters: true,
        ordinanceCandidates: [{
          identity: 'R-2',
          instrumentId: 'teo-plan',
          semanticDimension: 'ordinance',
          provenance: ['official:wms'],
          confidence: 'high',
          status: 'user_confirmed',
          confirmationSource: 'user',
        }],
        ordinanceResolution: {
          status: 'USER_CONFIRMED',
          identity: { code: 'R-2', label: 'R-2' },
          confidence: 'high',
          provenance: ['official:wms'],
          confirmationSource: 'user',
          confirmedByUser: true,
        },
        ordinanceDetermination: {
          technician: {
            value: 'R-2',
            origin: 'technician_selection',
            source: 'manual',
            verification: 'unverified',
          },
        },
        manualContext: {
          ordinance: 'R-2',
          provenance: 'manual',
          verification: 'unverified',
          recordedAt: '2026-08-27T10:00:00.000Z',
        },
      },
      latestDetectionRaw: {
        planning: {
          applicableInstruments: [{ id: 'teo-plan', status: 'current' }],
          documents: [{
            id: 'r2.pdf',
            instrumentId: 'teo-plan',
            title: 'Ordenanza R-2',
            sourceUrl: 'https://example.invalid/r2.pdf',
            binding: 'general',
            documentType: 'ordinance',
          }],
        },
      },
      userMessages: [],
      constraints: [],
    })
    mocks.abortSignal.mockResolvedValue({ data: [], error: { code: '57014', message: 'statement timeout' } })
    mocks.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: [{ id: 'sample-chunk-id' }], error: null }),
          in: vi.fn().mockReturnValue({
            range: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      }),
    })

    const response = await POST(new NextRequest('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expedienteId: 'expediente-org-a',
        message: '¿Cuál es la ordenanza aplicable a esta parcela y qué condiciones urbanísticas establece para ella? Cita las fuentes.',
      }),
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.error).toBeUndefined()
    expect(typeof payload.answer).toBe('string')
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
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
          content: JSON.stringify({ answerMode: 'definitive', claims: [{ id: 'claim_1', type: 'normative_fact', text: "La parcela está afectada por la zona de protección de carreteras [Fuente 1]. No puedo determinar el retranqueo urbanístico sin clasificación y ordenanza confirmadas.", sourceRefs: [1], appliesToParcel: 'unknown', numericTokens: [] }], missingFacts: [] }),
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
    mocks.completionCreate.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ answerMode: 'definitive', claims: [{ id: 'claim_1', type: 'normative_fact', text: "La norma permite licencia directa.", sourceRefs: [1], appliesToParcel: 'unknown', numericTokens: [] }], missingFacts: [] }) } }] })

    const response = await POST(new NextRequest('http://localhost/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expedienteId: 'expediente-org-a', message: '¿Es posible solicitar licencia de obra mayor directamente?' }),
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.safety.decision).toBe('answer')
    expect(payload.answer).toContain('La norma permite licencia directa.')
  })

  it('responde de forma condicionada para Ames y recupera la dependencia autonómica declarada', async () => {
    mocks.loadAuthorizedParcelInputs.mockResolvedValue({
      expediente: {
        id: 'expediente-org-a', orgId: 'org-a',
        refCatastral: '15002A076002700000ZO', municipio: 'ames',
        landClass: 'rustico', planeamiento: 'Plan general de ordenación municipal',
      },
      detected: {
        cadastralReference: '15002A076002700000ZO',
        municipalityName: 'Ames', municipalityId: 'ames', municipalityCode: '15002',
        locationSource: 'catastro', locationStatus: 'confirmed', locationConfidence: 'high',
        landClass: 'rustico', planningInstrument: 'Plan general de ordenación municipal',
        planningSource: 'siotuga', planningStatus: 'vigente',
        planningApplicabilityStatus: 'partial', planningCanAnswerConcreteParameters: false,
        urbanisticFacts: {
          classification: {
            value: { code: 'SR', label: 'Suelo rústico' },
            status: 'automatic_confirmed', origin: 'automatic_source', confidence: 'high',
            evidence: [{
              source: 'siotuga', sourceUrl: '', retrievedAt: '2026-08-16T00:00:00.000Z',
              method: 'DT 1ª L2/2016 (LSG): Suelo Rústico por defecto ante planeamiento disperso',
              scope: 'planning_classification',
            }],
            warnings: [], discrepancies: [], nextAction: 'none',
          },
          category: {
            status: 'not_available', confidence: 'unknown', evidence: [], warnings: [],
            discrepancies: [], nextAction: 'manual_selection',
          },
          consolidation: {
            status: 'not_applicable', confidence: 'high', evidence: [], warnings: [],
            discrepancies: [], nextAction: 'none',
          },
        },
      },
      latestDetectionRaw: {
        planning: {
          applicableInstruments: [{ id: '22184', status: 'current' }],
          documents: [{
            id: '10139', instrumentId: '22184', title: 'Normativa PXOM',
            sourceUrl: 'https://siotuga.xunta.gal/siotuga/documentos/urbanismo/AMES/documents/0023no009.pdf',
            binding: 'general', documentType: 'normative_text',
          }],
        },
      },
      userMessages: [], constraints: [],
    })
    mocks.abortSignal
      .mockResolvedValueOnce({
        data: [{
          chunk_id: 'lsg-1',
          texto: 'El régimen del suelo rústico exige comprobar la categoría y las autorizaciones sectoriales aplicables.',
          nombre_pdf: 'LSG CONSOLIDADA ENERO 2026- V2.pdf',
        }],
        error: null,
      })
    mocks.completionCreate.mockImplementation(async (request) => {
      const system = String(request.messages?.[0]?.content ?? '')
      if (system.includes('OUTPUT JSON REQUERIDO')) {
        return {
          choices: [{ message: { content: JSON.stringify({
            answerMode: 'conditional',
            claims: [
              {
                id: 'claim_1',
                type: 'normative_conditional',
                text: 'Con la información disponible todavía no puede confirmarse que la parcela sea edificable sin conocer la categoría de suelo rústico y las autorizaciones sectoriales aplicables.',
                sourceRefs: [1],
                appliesToParcel: 'conditional',
                numericTokens: [],
              },
            ],
            missingFacts: ['categoría de suelo rústico', 'autorizaciones sectoriales'],
          }) } }],
        }
      }
      return {
        choices: [{ message: { content: JSON.stringify({
          intent: 'normativa_lookup', required_scopes: ['autonomico'],
          required_categories: ['urbanismo_general'], needs_context: true,
          needs_sources: true, extracted_parameters: {},
        }) } }],
      }
    })

    const response = await POST(new NextRequest('http://localhost/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expedienteId: 'expediente-org-a', message: '¿Se puede construir en esta parcela?',
      }),
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.answer).toContain('todavía no puede confirmarse')
    expect(payload.answer).toContain('suelo rústico')
    expect(payload.safety).toMatchObject({ decision: 'answer', applicability: 'PARCIAL' })
    expect(payload.answer).not.toMatch(/Sí, se puede construir|No, no se puede construir/i)
    expect(payload.answer).not.toMatch(
      /whole_parcel|detected_zone|user_polygon|actionArea|unverified|manual_unverified|technician_validated|automatic_confirmed|automatic_probable|manual_review_required|automatic_source|spatial_intersection|implicit_planning_background|current_official|previous_official|coverageComplete|coverageReason|factRef|semanticCompleteness|\bhigh\b/
    )
    expect(mocks.rpc).toHaveBeenCalledWith(
      'match_normativa_chunks_scoped',
      expect.objectContaining({
        filter_municipio_codigo: '',
        filter_document_names: expect.arrayContaining(['LSG CONSOLIDADA ENERO 2026- V2.pdf']),
      })
    )
    expect(mocks.completionCreate.mock.calls.some(([request]) =>
      String(request?.messages?.[0]?.content ?? '').includes('OUTPUT JSON REQUERIDO')
    )).toBe(true)
  })

  it('consulta la normativa sectorial V1 sin restringirla al municipio', async () => {
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
        planningCanAnswerConcreteParameters: false,
      },
      userMessages: [],
      constraints: [{
        name: 'Carreteras: zona de protección',
        source: 'ideg',
        confidence: 0.95,
        confirmed: true,
      }],
    })
    mocks.abortSignal.mockResolvedValue({
      data: [{
        chunk_id: 'chunk-sectorial-carreteras',
        texto: 'La normativa de carreteras regula las zonas de protección [Fuente 1].',
        municipio_nombre: null,
        nombre_pdf: 'Lei_8_2013_Estradas_Galicia.pdf',
      }],
      error: null,
    })
    mocks.completionCreate.mockResolvedValue({
      choices: [{ message: {
        content: JSON.stringify({ answerMode: 'definitive', claims: [{ id: 'claim_1', type: 'normative_fact', text: "La normativa de carreteras regula las zonas de protección [Fuente 1].", sourceRefs: [1], appliesToParcel: 'unknown', numericTokens: [] }], missingFacts: [] }),
      } }],
    })

    const response = await POST(new NextRequest('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expedienteId: 'expediente-org-a',
        message: '¿Qué régimen de carreteras resulta aplicable?',
      }),
    }))

    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith(
      'match_normativa_chunks_scoped',
      expect.objectContaining({
        filter_municipio_codigo: '',
        filter_document_names: expect.arrayContaining(['Lei_8_2013_Estradas_Galicia.pdf']),
      })
    )
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

    mocks.completionCreate.mockImplementation((req: { messages: Array<{ content: string }> }) => {
      const systemPrompt = req.messages[0].content
      // buildReviewSafetyPrompt is used when review.length > 0, scope='regime', status='PARCIAL'
      if (systemPrompt.includes('Tu tarea es extraer la información solicitada') ||
          systemPrompt.includes('FRAGMENTOS AUTORIZADOS')) {
        return Promise.resolve({
          choices: [{ message: { content: JSON.stringify({
            answerMode: 'partial',
            claims: [
              {
                id: 'claim_1',
                type: 'normative_fact',
                text: 'La normativa recuperada contiene disposiciones sobre retranqueos según el documento [Fuente 1].',
                sourceRefs: [1],
                appliesToParcel: 'conditional',
                numericTokens: [],
              },
              {
                id: 'claim_2',
                type: 'limitation',
                text: 'La relación de estas determinaciones con el ámbito CASCAS o con la ordenanza aplicable todavía no está acreditada.',
                sourceRefs: [1],
                appliesToParcel: 'conditional',
                numericTokens: [],
              },
            ],
            missingFacts: ['ordenanza o ficha de zona CASCAS aplicable'],
          }) } }],
        })
      }
      return Promise.resolve({
        choices: [{ message: { content: JSON.stringify({
          intent: 'normativa_lookup', required_scopes: [],
          required_categories: [], needs_context: true,
          needs_sources: true, extracted_parameters: {},
        }) } }],
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

    expect(payload.answer).toContain('disposiciones sobre retranqueos')
    expect(payload.answer).toContain('\u00e1mbito CASCAS')
    expect(payload.safety.decision).toBe('answer')
    expect(payload.answer).not.toContain('No se ha recuperado evidencia documental suficiente')
    expect(payload.answer).not.toMatch(/otro \u00e1mbito/i)
    expect(payload.answer).not.toMatch(/\b\d+(?:[.,]\d+)?\s*m\b/i)
  })

  it('short-circuits municipal retrieval and returns safe abstention when municipality has zero corpus in normativa_chunks', async () => {
    mocks.loadAuthorizedParcelInputs.mockResolvedValue({
      expediente: { id: 'expediente-org-a', orgId: 'org-a' },
      detected: {
        cadastralReference: '36059A03900148',
        municipalityName: 'Vila de Cruces',
        municipalityId: 'vila_de_cruces',
        municipalityCode: '36059',
        locationSource: 'catastro',
        locationStatus: 'confirmed',
        locationConfidence: 'high',
        landClass: 'urbano_consolidado',
        planningArea: 'CASCO',
        planningInstrument: 'Normas subsidiarias',
        planningSource: 'siotuga',
        planningStatus: 'vigente',
        planningCanAnswerConcreteParameters: false,
        manualContext: {
          ordinance: 'Ordenanza 1',
          provenance: 'manual',
          verification: 'technician_validated',
          recordedAt: '2026-08-05T12:00:00.000Z',
        },
      },
      latestDetectionRaw: {
        planning: {
          applicableInstruments: [{ id: '23045', status: 'current' }],
          documents: [{
            id: '1002no101.pdf',
            instrumentId: '23045',
            title: 'Normativa',
            sourceUrl: 'https://example.invalid/1002no101.pdf',
            binding: 'general',
            documentType: 'normative_text',
          }],
        },
      },
      userMessages: [],
      constraints: [],
    })

    // Mock zero corpus for the municipality (e.g. 36059)
    const emptyAvailability = vi.fn()
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null })
    mocks.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          limit: emptyAvailability,
        }),
      }),
    })

    const response = await POST(new NextRequest('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expedienteId: 'expediente-org-a',
        message: '¿Cuál es el retranqueo aplicable?',
      }),
    }))

    expect(response.status).toBe(200)
    const payload = await response.json()

    // match_normativa_chunks_scoped should NOT have been called via rpc
    expect(mocks.rpc).not.toHaveBeenCalledWith('match_normativa_chunks_scoped', expect.anything())
    expect(payload.safety.decision).toBe('abstain')
    expect(payload.answer).toContain('CONCLUSIÓN')
    expect(payload.answer).toContain('Ordenanza 1 (confirmada por el usuario)')
    expect(payload.answer).not.toContain('MISSING_REGIME_VALIDATION')
    expect(payload.answer).not.toContain('fragmentos recuperados')
  })

  it('returns 500 when corpus availability check encounters a real database error', async () => {
    clearMunicipalCorpusAvailabilityCache()
    mocks.loadAuthorizedParcelInputs.mockResolvedValue({
      expediente: { id: 'expediente-org-a', orgId: 'org-a' },
      detected: {
        cadastralReference: '27001A03900148',
        municipalityName: 'Abadín',
        municipalityId: 'abadin',
        municipalityCode: '27001',
        locationSource: 'catastro',
        locationStatus: 'confirmed',
        locationConfidence: 'high',
        landClass: 'urbano_consolidado',
        planningArea: 'CASCO',
        planningInstrument: 'Normas subsidiarias',
        planningSource: 'siotuga',
        planningStatus: 'vigente',
        planningCanAnswerConcreteParameters: false,
        manualContext: {
          ordinance: 'Ordenanza 1',
          provenance: 'manual',
          verification: 'technician_validated',
          recordedAt: '2026-08-05T12:00:00.000Z',
        },
      },
      latestDetectionRaw: {
        planning: {
          applicableInstruments: [{ id: '23045', status: 'current' }],
          documents: [{
            id: '1002no101.pdf',
            instrumentId: '23045',
            title: 'Normativa',
            sourceUrl: 'https://example.invalid/1002no101.pdf',
            binding: 'general',
            documentType: 'normative_text',
          }],
        },
      },
      userMessages: [],
      constraints: [],
    })

    const dbError = { message: 'Connection pool exhausted', code: '57P01' }
    mocks.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: null, error: dbError }),
        }),
      }),
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
    expect(response.status).toBe(500)
    expect(payload.error).toBe('Error querying database')
  })
})
