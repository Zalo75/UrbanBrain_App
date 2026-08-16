import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { validateGeneratedAnswer } from '@/application/parcel-context/responseSafety'
import { classifyParcelQuestionScope, requiresDeterminedParcelRegime } from '@/application/parcel-context/applicabilityEngine'

const mocks = vi.hoisted(() => ({
  getExpedienteAccess: vi.fn(),
  loadAuthorizedParcelInputs: vi.fn(),
  rpc: vi.fn(),
  abortSignal: vi.fn(),
  completionCreate: vi.fn(),
}))

vi.mock('@/infrastructure/db/client', () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn().mockResolvedValue([{ id: 'msg-1' }]),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([])
      }))
    })),
  },
}))

vi.mock('@/application/authorization/expedienteAccess', () => ({
  getExpedienteAccess: vi.fn(),
}))

vi.mock('@/infrastructure/db/parcelContextRepository', () => ({
  loadAuthorizedParcelInputs: vi.fn(),
}))

vi.mock('@/application/parcel-context/normalizeParcelContext', async (importOriginal) => {
  const actual = await importOriginal<any>()
  return {
    ...actual,
    buildNormalizedParcelContext: vi.fn(() => ({
      conflicts: [],
      knownConstraints: [],
      pendingValidation: [],
      urbanisticFacts: {
        classification: {
          status: 'automatic_confirmed',
          value: { code: 'SR', label: 'Suelo rústico' },
          origin: 'implicit_planning_background',
          evidence: [{ method: 'DT 1ª L2/2016 (LSG): Suelo Rústico por defecto ante planeamiento disperso' }],
          confidence: 'high',
          discrepancies: []
        },
        category: { status: 'unverified', origin: 'manual_unverified', confidence: 'low', discrepancies: [] },
      }
    }))
  }
})

vi.mock('@/application/parcel-context/applicabilityEngine', async (importOriginal) => {
  const actual = await importOriginal<any>()
  return {
    ...actual,
    evaluateApplicability: vi.fn(() => ({
      status: 'PARCIAL',
      applicable: [{ id: 'c1', chunk_id: 'c1', content: 'texto', title: 'titulo', hierarchy: 'estatal', visibleSourceKind: 'normative_v1' }],
      rejected: [],
      review: [],
      missingData: [],
      conflicts: [],
      warnings: [],
      canAnswerConcreteParameters: true,
      canAnswerConditionalViability: true
    })),
    classifyParcelQuestionScope: vi.fn(() => 'viability'),
    isConditionalViabilityQuestion: vi.fn(() => true),
    requiresDeterminedParcelRegime: vi.fn(() => false)
  }
})

vi.mock('@/application/parcel-context/responseSafety', async (importOriginal) => {
  const actual = await importOriginal<any>()
  return {
    ...actual,
    validateGeneratedAnswer: vi.fn((answer: string) => {
      if (answer.includes('edificabilidad es 5.0')) {
        return { valid: false, reasons: ['La respuesta atribuye un parámetro de parcela sin régimen determinado.'], citations: [] }
      }
      return { valid: true, reasons: [], citations: [1] }
    }),
    buildSafeAbstention: vi.fn(() => false)
  }
})

vi.mock('@/application/chat/chatRequestGuard', () => ({
  acquireChatSlot: vi.fn(() => ({ ok: true, release: vi.fn() })),
  CHAT_REQUEST_TIMEOUT_MS: 30000,
  MAX_CHAT_MESSAGE_LENGTH: 4000
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: (...args: any[]) => {
      mocks.rpc(...args)
      return {
        abortSignal: mocks.abortSignal,
      }
    },
  }),
}))

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class GoogleGenerativeAI {
    getGenerativeModel() {
      return {
        embedContent: vi.fn().mockResolvedValue({
          embedding: { values: Array(768).fill(0.1) }
        })
      }
    }
  },
  TaskType: { RETRIEVAL_QUERY: 'RETRIEVAL_QUERY' }
}))

vi.mock('openai', () => {
  return {
    default: class OpenAI {
      chat = {
        completions: {
          create: mocks.completionCreate,
        },
      }
    }
  }
})

// Import POST after mocks
import { POST } from './route'
import { NextRequest } from 'next/server'
import * as parcelContextRepo from '@/infrastructure/db/parcelContextRepository'
import { getExpedienteAccess } from '@/application/authorization/expedienteAccess'

// Apply mocks to imported modules
vi.mocked(getExpedienteAccess).mockImplementation(mocks.getExpedienteAccess)
vi.mocked(parcelContextRepo.loadAuthorizedParcelInputs).mockImplementation(mocks.loadAuthorizedParcelInputs)


describe('NormativeAnswerPerf Telemetry', () => {
  let consoleInfoSpy: any

  let consoleErrorSpy: any

  beforeEach(() => {
    vi.clearAllMocks()
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => { console.log('CAUGHT ERR:', ...args) })

    mocks.getExpedienteAccess.mockResolvedValue({ ok: true, userId: 'user-telemetry', role: 'admin' })
    mocks.loadAuthorizedParcelInputs.mockResolvedValue({
      expedienteId: 'exp-telemetry',
      expediente: { landClass: null, urbanPlanningZone: null },
      detected: {
        landClass: null,
        urbanisticFacts: {
          classification: {
            status: 'automatic_confirmed',
            value: { code: 'SR', label: 'Suelo rústico' },
            origin: 'implicit_planning_background',
            evidence: [{ method: 'DT 1ª L2/2016 (LSG): Suelo Rústico por defecto ante planeamiento disperso' }],
            confidence: 'high',
            discrepancies: []
          },
          category: { status: 'unverified', origin: 'manual_unverified', confidence: 'low', discrepancies: [] },
        },
        actionAreaSelection: null,
        municipalityCode: '15002',
        municipalityName: 'Ames',
        planningInstrument: 'PGOM'
      },
      constraints: [],
      userMessages: [],
      conflicts: []
    })

    mocks.rpc.mockReturnValue({ abortSignal: mocks.abortSignal })
    mocks.abortSignal.mockResolvedValue({
      data: [{ chunk_id: 'c1', texto: 'El régimen del suelo rústico. [Fuente 1]', nombre_pdf: 'LSG CONSOLIDADA ENERO 2026- V2.pdf' }],
      error: null,
    })
    mocks.completionCreate.mockResolvedValue({
      choices: [{ message: { content: 'CONCLUSIÓN\nEl régimen se aplica. [Fuente 1]' } }],
    })
  })

  afterEach(() => {
    consoleInfoSpy.mockRestore()
  })

  it('1. Ames: viabilidad condicionada con SR y autonómica (supplementaryV1 > 0 y finalDecision=answer)', async () => {
    const response = await POST(new NextRequest('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expedienteId: 'exp-telemetry', message: '¿Se puede construir?' }),
    }))
    const json = await response.json()
    if (response.status !== 200) console.log('ERROR JSON:', json)
    expect(response.status).toBe(200)

    const telemetryCall = consoleInfoSpy.mock.calls.find((call: any) => call[0] === '[NormativeAnswerPerf]')
    expect(telemetryCall).toBeDefined()
    const telemetryObj = telemetryCall![1]

    expect(telemetryObj.supplementaryV1CandidateCount).toBeGreaterThan(0)
    expect(telemetryObj.supplementaryCandidateCountsByLayer.autonomico).toBeGreaterThan(0)
    expect(telemetryObj.finalDecision).toBe('answer')
    expect(telemetryObj.validationValid).toBe(true)
    expect(telemetryObj.concreteParameterRequested).toBe(false)

    // Verify RPC calls
    const rpcCalls = mocks.rpc.mock.calls;
    // console.log("RPC CALLS: ", JSON.stringify(rpcCalls, null, 2))
    
    // municipal is retrieved first. If retrieveMunicipal is false, it's not called.
    // wait, in the test, does it call municipal? 
    // let's just assert the autonómico one for now
    const autonmicoRpcCall = rpcCalls.find(call => call[1]?.filter_municipio_codigo === '');
    expect(autonmicoRpcCall).toBeDefined();
  })

  it('2. V2=0 no implica loguear que no existen candidatos V1 suplementarios', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    process.env.KNOWLEDGE_ENGINE = 'v2'
    
    await POST(new NextRequest('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expedienteId: 'exp-telemetry', message: '¿Se puede construir?' }),
    }))

    const v2LogCall = consoleLogSpy.mock.calls.find(call => String(call[0]).includes('KNOWLEDGE ENGINE RESPONSE MODE'))
    expect(v2LogCall).toBeDefined()
    const logOutput = String(v2LogCall![0])
    
    expect(logOutput).toContain('- V1 Suplementario: 1') // We mocked 1 chunk from abortSignal
    expect(logOutput).toContain('V1_SUPLEMENTARIO_Y_MUNICIPAL')
    expect(logOutput).not.toContain('V1_FALLBACK')

    consoleLogSpy.mockRestore()
    process.env.KNOWLEDGE_ENGINE = undefined
  })

  it('3. validation failure produce: validationValid=false, validationReasonCodes sanitizados, finalDecision=abstain', async () => {
    vi.mocked(validateGeneratedAnswer).mockReturnValueOnce({
      valid: false,
      reasons: ['La respuesta atribuye un parámetro de parcela sin régimen determinado.'],
      citations: []
    })
    
    mocks.completionCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'CONCLUSIÓN\nEl régimen se aplica, la edificabilidad es 5.0.' } }], // Invalid, attributes without regime
    })

    await POST(new NextRequest('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expedienteId: 'exp-telemetry', message: '¿Se puede construir?' }),
    }))

    const telemetryCall = consoleInfoSpy.mock.calls.find((call: any) => call[0] === '[NormativeAnswerPerf]')
    expect(telemetryCall).toBeDefined()
    const telemetryObj = telemetryCall![1]

    expect(telemetryObj.validationValid).toBe(false)
    expect(telemetryObj.finalDecision).toBe('abstain')
    expect(Array.isArray(telemetryObj.validationReasonCodes)).toBe(true)
    expect(telemetryObj.validationReasonCodes.length).toBeGreaterThan(0)
    expect(telemetryObj.validationReasonCodes).toContain('ATTRIBUTED_PARAMETER_WITHOUT_REGIME')
  })

  it('5. ningún log contiene pregunta, respuesta o chunks', async () => {
    await POST(new NextRequest('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expedienteId: 'exp-telemetry', message: '¿Se puede construir? PREGUNTA_SECRETA_XYZ' }),
    }))

    const allInfoLogs = consoleInfoSpy.mock.calls.map((c: any) => JSON.stringify(c)).join(' ')
    expect(allInfoLogs).not.toContain('PREGUNTA_SECRETA_XYZ')
    expect(allInfoLogs).not.toContain('El régimen del suelo rústico') // Chunk text
    expect(allInfoLogs).not.toContain('CONCLUSIÓN') // LLM Response text
  })

  it('6. Valdoviño: parámetro concreto (retranqueo) con SNR/SNRSC y normativa municipal', async () => {
    vi.mocked(classifyParcelQuestionScope).mockReturnValueOnce('parameters')
    vi.mocked(requiresDeterminedParcelRegime).mockReturnValueOnce(true)

    mocks.loadAuthorizedParcelInputs.mockResolvedValueOnce({
      expedienteId: 'exp-telemetry',
      expediente: { landClass: null, urbanPlanningZone: null },
      detected: {
        landClass: null,
        urbanisticFacts: {
          classification: {
            status: 'automatic_confirmed',
            value: { code: 'SNR', label: 'Suelo no urbanizable' },
            origin: 'implicit_planning_background',
            evidence: [],
            confidence: 'high',
            discrepancies: []
          },
          category: { 
            status: 'automatic_confirmed',
            value: { code: 'SNRSC', label: 'SNR de protección de costas' },
            origin: 'implicit_planning_background',
            confidence: 'high',
            discrepancies: []
          },
        },
        actionAreaSelection: null,
        municipalityCode: '15087',
        municipalityName: 'Valdoviño',
        planningInstrument: 'NNSS'
      },
      constraints: [],
      userMessages: [],
      conflicts: []
    })

    const response = await POST(new NextRequest('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expedienteId: 'exp-telemetry', message: '¿Cuánto retranqueo hay que dejar en esta parcela?' }),
    }))
    
    expect(response.status).toBe(200)

    const telemetryCall = consoleInfoSpy.mock.calls.find((call: any) => call[0] === '[NormativeAnswerPerf]')
    expect(telemetryCall).toBeDefined()
    const telemetryObj = telemetryCall![1]

    expect(telemetryObj.concreteParameterRequested).toBe(true)
    expect(typeof telemetryObj.municipalCandidateCount).toBe('number')
    expect(typeof telemetryObj.municipalDocumentCount).toBe('number')
    expect(Array.isArray(telemetryObj.missingDataCodes)).toBe(true)

    console.log('Valdoviño Scope Diagnostic:', {
      municipalScopedRetrieval: telemetryObj.municipalScopedRetrieval,
      municipalScopeDocumentNameCount: telemetryObj.municipalScopeDocumentNameCount,
      municipalScopeHasOrdinance: telemetryObj.municipalScopeHasOrdinance,
      municipalScopeDiagnosticCode: telemetryObj.municipalScopeDiagnosticCode,
    })
  })
})
