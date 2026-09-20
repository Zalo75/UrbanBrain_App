import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TerritorialResolution } from '@/domain/territorial-resolver/types'

const mocks = vi.hoisted(() => ({
  loadAuthorizedParcelInputs: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
}))

vi.mock('@/infrastructure/db/parcelContextRepository', () => ({
  loadAuthorizedParcelInputs: mocks.loadAuthorizedParcelInputs,
}))
vi.mock('@/infrastructure/db/client', () => ({
  db: { insert: mocks.insert, update: mocks.update },
}))

import { ContextDetectionEngine } from './ContextDetectionEngine'

const official: TerritorialResolution = {
  status: 'confirmed',
  confidence: 'high',
  inputMethod: 'cadastral_reference',
  cadastralReference: '1234567NH4913S',
  municipality: 'Betanzos',
  municipalityCode: '15009',
  coordinates: { lat: 43.28, lng: -8.26 },
  candidates: [],
  evidence: [
    {
      source: 'catastro',
      sourceUrl: 'https://official.test',
      retrievedAt: '2026-07-13T10:00:00.000Z',
      method: 'fixture',
    },
  ],
  warnings: [],
  conflicts: [],
  planning: {
    status: 'partial',
    instrument: 'Normas Subsidiarias',
    evidence: [],
    warnings: [],
    canAnswerConcreteParameters: false,
  },
  affects: {
    analysisGeometry: 'point',
    detected: [],
    canRuleOutUndetectedAffects: false,
    warnings: [],
  },
  resolvedAt: '2026-07-13T10:00:00.000Z',
}

const failed: TerritorialResolution = {
  status: 'unresolved',
  confidence: 'low',
  inputMethod: 'cadastral_reference',
  candidates: [],
  evidence: [],
  warnings: [],
  conflicts: [],
  sourceChecks: [
    {
      source: 'catastro',
      status: 'timeout',
      checkedAt: '2026-07-14T10:00:00.000Z',
      message: 'Catastro no responde.',
    },
  ],
  planning: { status: 'not_determined', evidence: [], warnings: [] },
  affects: {
    analysisGeometry: 'none',
    detected: [],
    canRuleOutUndetectedAffects: false,
    warnings: [],
  },
  resolvedAt: '2026-07-14T10:00:00.000Z',
}

describe('ContextDetectionEngine source resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.insert.mockReturnValue({ values: mocks.values })
    mocks.values.mockResolvedValue(undefined)
    mocks.update.mockReturnValue({ set: mocks.set })
    mocks.set.mockReturnValue({ where: mocks.where })
    mocks.where.mockResolvedValue(undefined)
    mocks.loadAuthorizedParcelInputs.mockResolvedValue({
      expediente: { id: 'exp-a', orgId: 'org-a', municipio: 'betanzos' },
      detected: null,
      latestDetectionRaw: official,
      userMessages: [],
      constraints: [],
    })
  })

  it('persiste por separado el intento fallido y el ultimo contexto oficial valido', async () => {
    await new ContextDetectionEngine(vi.fn(async () => ({ ...failed }))).detectContextFromInput(
      'exp-a',
      'user-a',
      { cadastralReference: '1234567NH4913S' },
      '2026-07-14T10:00:00.000Z'
    )

    const persisted = mocks.values.mock.calls[0][0]
    expect(persisted.rawResponse).toMatchObject({
      status: 'unresolved',
      continuity: {
        usingPreviousOfficialContext: true,
        effectiveOfficialContext: { status: 'confirmed', municipality: 'Betanzos' },
      },
    })
    expect(persisted.summary).toMatchObject({
      municipalityName: 'Betanzos',
      reliability: {
        mode: 'previous_official',
        latestAttemptAt: '2026-07-14T10:00:00.000Z',
        officialContextResolvedAt: '2026-07-13T10:00:00.000Z',
      },
    })
  })

  it('persiste los candidatos previos cuando falla transitoriamente el proveedor de zoning', async () => {
    const previous = JSON.parse(JSON.stringify(official)) as TerritorialResolution
    previous.planning.applicableInstruments = [{
      id: 'instrument-teo',
      name: 'Plan oficial',
      kind: 'general',
      status: 'current',
      sourceUrl: 'official:plan',
    }]
    previous.planning.ordinanceCandidates = [{
      identity: 'R-2',
      instrumentId: 'instrument-teo',
      semanticDimension: 'ordinance',
      provenance: ['official:previous-zoning'],
      status: 'active',
    }]
    previous.planning.contextualCandidates = [{
      identity: 'SU-C',
      instrumentId: 'instrument-teo',
      semanticDimension: 'category',
      provenance: ['official:previous-classification'],
      status: 'active',
    }]
    mocks.loadAuthorizedParcelInputs.mockResolvedValueOnce({
      expediente: { id: 'exp-a', orgId: 'org-a', municipio: 'betanzos' },
      detected: null,
      latestDetectionRaw: previous,
      userMessages: [],
      constraints: [],
    })

    const current = JSON.parse(JSON.stringify(official)) as TerritorialResolution
    current.planning.applicableInstruments = previous.planning.applicableInstruments
    current.planning.ordinanceCandidates = []
    current.planning.contextualCandidates = []
    current.planning.sourceChecks = [{
      source: 'siotuga',
      status: 'unavailable',
      checkedAt: '2026-08-27T10:00:00.000Z',
      message: 'fetch failed',
    }]

    await new ContextDetectionEngine(vi.fn(async () => current)).detectContextFromInput(
      'exp-a',
      'user-a',
      { cadastralReference: '1234567NH4913S' },
    )

    const persisted = mocks.values.mock.calls[0][0]
    expect(persisted.rawResponse.planning.ordinanceCandidates.map((candidate: { identity: string }) => candidate.identity)).toEqual(['R-2'])
    expect(persisted.rawResponse.planning.contextualCandidates.map((candidate: { identity: string }) => candidate.identity)).toEqual(['SU-C'])
    expect(persisted.rawResponse.planning.status).toBe('partial')
  })

  it('no reutiliza el contexto oficial si el usuario consulta otra parcela', async () => {
    await new ContextDetectionEngine(vi.fn(async () => ({ ...failed }))).detectContextFromInput(
      'exp-a',
      'user-a',
      { cadastralReference: '9999999NH4999S' }
    )

    const persisted = mocks.values.mock.calls[0][0]
    expect(persisted.rawResponse.continuity.usingPreviousOfficialContext).toBe(false)
    expect(persisted.rawResponse.continuity.effectiveOfficialContext).toBeUndefined()
    expect(persisted.summary.municipalityName).toBeUndefined()
  })

  it('persiste el contexto manual sin fuentes oficiales ficticias', async () => {
    await new ContextDetectionEngine().recordManualContext(
      'exp-a',
      'user-a',
      { address: 'Direccion conocida' },
      {
        municipality: 'Betanzos',
        address: 'Direccion conocida',
        provenance: 'manual',
        verification: 'unverified',
        recordedAt: '2026-07-14T11:00:00.000Z',
      }
    )

    const persisted = mocks.values.mock.calls[0][0]
    expect(persisted.summary.manualContext).toMatchObject({
      provenance: 'manual',
      verification: 'unverified',
    })
    expect(persisted.summary.locationSource).toBeUndefined()
    expect(persisted.sourceApis).toEqual([])
  })

  it('confirma localmente una candidata oficial y conserva su procedencia', async () => {
    const previous = JSON.parse(JSON.stringify(official)) as TerritorialResolution
    previous.planning = {
      ...previous.planning,
      applicableInstruments: [{
        id: 'instrument-teo',
        name: 'Plan oficial',
        kind: 'general',
        status: 'current',
        sourceUrl: 'official:plan',
      }],
      ordinanceCandidates: [{
        identity: 'R-2',
        instrumentId: 'instrument-teo',
        semanticDimension: 'ordinance',
        provenance: ['official:wms', 'official:legend'],
        status: 'active',
      }, {
        identity: 'R-3',
        instrumentId: 'instrument-teo',
        semanticDimension: 'ordinance',
        provenance: ['official:wms', 'official:legend'],
        status: 'active',
      }],
      ordinanceResolution: {
        status: 'REVIEW_REQUIRED',
        identity: { code: 'R-2', label: 'R-2' },
        confidence: 'high',
        provenance: ['official:wms', 'official:legend'],
      },
    }
    mocks.loadAuthorizedParcelInputs.mockResolvedValueOnce({
      expediente: { id: 'exp-a', orgId: 'org-a', ownerId: 'user-a', municipio: 'betanzos' },
      detected: null,
      latestDetectionRaw: previous,
      userMessages: [],
      constraints: [],
    })

    const resolver = vi.fn()
    const result = await new ContextDetectionEngine(resolver).confirmOrdinanceCandidate(
      'exp-a',
      'user-a',
      { cadastralReference: '1234567NH4913S' },
      'R-3',
      '2026-07-14T12:00:00.000Z',
    )

    expect(result?.continuity?.manualContext?.ordinance).toBe('R-3')
    expect(result?.continuity?.manualContext?.ordinanceDetermination?.technician).toMatchObject({
      value: 'R-3',
      origin: 'technician_selection',
      verification: 'unverified',
      recordedBy: 'user-a',
    })
    const persisted = mocks.values.mock.calls[0][0]
    expect(persisted.rawResponse.continuity.effectiveOfficialContext.planning.ordinanceCandidates[0].provenance)
      .toEqual(['official:wms', 'official:legend'])
    expect(persisted.rawResponse.planning.ordinanceCandidates[1]).toMatchObject({
      identity: 'R-3',
      status: 'user_confirmed',
      confirmationSource: 'user',
    })
    expect(persisted.rawResponse.planning.ordinanceResolution).toMatchObject({
      status: 'USER_CONFIRMED',
      identity: { code: 'R-3' },
      confirmedByUser: true,
    })
    expect(persisted.summary.ordinanceCandidates?.[1]).toMatchObject({
      identity: 'R-3',
      status: 'user_confirmed',
    })
    expect(persisted.summary.ordinanceResolution).toMatchObject({
      status: 'USER_CONFIRMED',
      identity: { code: 'R-3' },
    })
    expect(mocks.values).toHaveBeenCalledTimes(1)
    expect(resolver).not.toHaveBeenCalled()
  })

  it('conserva los hechos urbanisticos V2 en el resumen y la respuesta cruda', async () => {
    const urbanisticFacts = {
      classification: {
        value: { code: 'SU', label: 'Suelo urbano' },
        status: 'automatic_confirmed' as const,
        confidence: 'high' as const,
        evidence: [],
        warnings: [],
        discrepancies: [],
        nextAction: 'none' as const,
      },
      category: {
        status: 'manual_review_required' as const,
        confidence: 'high' as const,
        evidence: [],
        warnings: [],
        discrepancies: [],
        nextAction: 'review_official_sources' as const,
      },
      consolidation: {
        status: 'manual_review_required' as const,
        confidence: 'high' as const,
        evidence: [],
        warnings: [],
        discrepancies: [],
        nextAction: 'review_official_sources' as const,
      },
    }
    const current = {
      ...official,
      planning: { ...official.planning, urbanisticFacts },
    }

    await new ContextDetectionEngine().persistAuthorizedDetection('exp-a', 'user-a', current)

    const persisted = mocks.values.mock.calls[0][0]
    expect(persisted.rawResponse.planning.urbanisticFacts).toBe(urbanisticFacts)
    expect(persisted.summary.urbanisticFacts).toBe(urbanisticFacts)
  })

  it('identifica el intento mas reciente aunque una respuesta anterior termine despues', async () => {
    let finishOlder!: (value: TerritorialResolution) => void
    let finishNewer!: (value: TerritorialResolution) => void
    const resolver = vi.fn(
      (input: { cadastralReference?: string | null }) =>
        new Promise<TerritorialResolution>((resolve) => {
          if (input.cadastralReference === '1234567NH4913S') finishOlder = resolve
          else finishNewer = resolve
        })
    )
    const engine = new ContextDetectionEngine(resolver)
    const older = engine.detectContextFromInput(
      'exp-a',
      'user-a',
      { cadastralReference: '1234567NH4913S' },
      '2026-07-14T10:00:00.000Z'
    )
    const newer = engine.detectContextFromInput(
      'exp-a',
      'user-a',
      { cadastralReference: '9999999NH4999S' },
      '2026-07-14T10:00:01.000Z'
    )

    await vi.waitFor(() => expect(resolver).toHaveBeenCalledTimes(2))
    finishNewer({ ...official, cadastralReference: '9999999NH4999S' })
    await newer
    finishOlder({ ...official })
    await older

    expect(mocks.values.mock.calls[0][0].summary.reliability.latestAttemptAt).toBe(
      '2026-07-14T10:00:01.000Z'
    )
    expect(mocks.values.mock.calls[1][0].summary.reliability.latestAttemptAt).toBe(
      '2026-07-14T10:00:00.000Z'
    )
  })
})
