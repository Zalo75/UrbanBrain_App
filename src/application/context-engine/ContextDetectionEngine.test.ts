import { beforeEach, describe, expect, it, vi } from 'vitest'

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
import type { TerritorialResolution } from '@/domain/territorial-resolver/types'

const resolution: TerritorialResolution = {
  status: 'confirmed',
  confidence: 'high',
  inputMethod: 'cadastral_reference',
  cadastralReference: '8424001NJ4082S',
  normalizedAddress: 'AV PEDRO BARRIE MAZA 19 A CORUÑA',
  municipality: 'A CORUÑA',
  municipalityCode: '15030',
  province: 'A CORUÑA',
  provinceCode: '15',
  coordinates: { lat: 43.371, lng: -8.404 },
  candidates: [],
  evidence: [
    {
      source: 'catastro',
      sourceUrl: 'https://official.test',
      retrievedAt: '2026-07-13T00:00:00.000Z',
      method: 'fixture',
    },
  ],
  warnings: [],
  conflicts: [],
  planning: { status: 'not_determined', evidence: [], warnings: [] },
  affects: {
    analysisGeometry: 'point',
    detected: [],
    canRuleOutUndetectedAffects: false,
    warnings: [],
  },
  resolvedAt: '2026-07-13T00:00:00.000Z',
}

describe('ContextDetectionEngine tenant boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.insert.mockReturnValue({ values: mocks.values })
    mocks.values.mockResolvedValue(undefined)
  })

  it('no resuelve ni persiste si el usuario no tiene acceso al expediente', async () => {
    mocks.loadAuthorizedParcelInputs.mockResolvedValue(null)
    const resolver = vi.fn(async () => resolution)
    const engine = new ContextDetectionEngine(resolver)

    const result = await engine.detectContext('expediente-org-b', 'usuario-org-a')

    expect(result).toBeNull()
    expect(resolver).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('usa exclusivamente la localización cargada después de autorizar', async () => {
    mocks.loadAuthorizedParcelInputs.mockResolvedValue({
      expediente: {
        id: 'expediente-org-a',
        orgId: 'org-a',
        refCatastral: '8424001NJ4082S',
        address: 'Dirección autorizada',
        lat: 43.371,
        lng: -8.404,
        municipio: 'a_coruna',
      },
      detected: null,
      userMessages: [],
      constraints: [],
    })
    const resolver = vi.fn(async () => resolution)
    const engine = new ContextDetectionEngine(resolver)

    await engine.detectContext('expediente-org-a', 'usuario-org-a')

    expect(resolver).toHaveBeenCalledWith({
      cadastralReference: '8424001NJ4082S',
      coordinates: { lat: 43.371, lng: -8.404 },
      address: 'Dirección autorizada',
      declaredMunicipality: 'a_coruna',
    })
    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({ expedienteId: 'expediente-org-a', geometryStored: false })
    )
    expect(mocks.values.mock.calls[0][0].summary.planningStatus).toBeUndefined()
  })

  it('persiste todas las fuentes aplicadas, no sólo la fuente de localización', async () => {
    mocks.loadAuthorizedParcelInputs.mockResolvedValue({
      expediente: { id: 'expediente-org-a', orgId: 'org-a', municipio: 'a_coruna' },
      detected: null,
      userMessages: [],
      constraints: [],
    })
    const multiSource: TerritorialResolution = {
      ...resolution,
      planning: {
        status: 'determined',
        instrument: 'PXOM',
        warnings: [],
        evidence: [
          {
            source: 'siotuga',
            sourceUrl: 'https://siotuga.xunta.gal/',
            retrievedAt: resolution.resolvedAt,
            method: 'fixture',
          },
        ],
      },
      affects: {
        analysisGeometry: 'point',
        canRuleOutUndetectedAffects: false,
        warnings: [],
        detected: [
          {
            category: 'patrimonio',
            name: 'BIC',
            attributes: {},
            confidence: 'high',
            evidence: {
              source: 'ideg',
              sourceUrl: 'https://ideg.xunta.gal/',
              retrievedAt: resolution.resolvedAt,
              method: 'fixture',
            },
          },
        ],
      },
    }
    const engine = new ContextDetectionEngine(vi.fn(async () => multiSource))

    await engine.detectContext('expediente-org-a', 'usuario-org-a')

    expect(mocks.values.mock.calls[0][0].sourceApis).toEqual(['catastro', 'siotuga', 'ideg'])
    expect(mocks.values.mock.calls[0][0].summary.planningStatus).toBe('vigente')
  })
})
