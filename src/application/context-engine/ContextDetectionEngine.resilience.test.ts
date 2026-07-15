import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TerritorialResolution } from '@/domain/territorial-resolver/types'

const mocks = vi.hoisted(() => ({
  loadAuthorizedParcelInputs: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
}))

vi.mock('@/infrastructure/db/parcelContextRepository', () => ({
  loadAuthorizedParcelInputs: mocks.loadAuthorizedParcelInputs,
}))
vi.mock('@/infrastructure/db/client', () => ({
  db: { insert: mocks.insert },
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
