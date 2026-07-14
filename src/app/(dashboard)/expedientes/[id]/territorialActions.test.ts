import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TerritorialResolution } from '@/domain/territorial-resolver/types'

const mocks = vi.hoisted(() => ({
  getExpedienteAccess: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
  detectContextFromInput: vi.fn(),
  recordManualContext: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('@/application/authorization/expedienteAccess', () => ({
  getExpedienteAccess: mocks.getExpedienteAccess,
}))
vi.mock('@/infrastructure/db/client', () => ({ db: { update: mocks.update } }))
vi.mock('@/application/context-engine/ContextDetectionEngine', () => ({
  ContextDetectionEngine: class {
    detectContextFromInput = mocks.detectContextFromInput
    recordManualContext = mocks.recordManualContext
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import { resolveTerritorialContextAction } from './territorialActions'

const resolution: TerritorialResolution = {
  status: 'confirmed',
  confidence: 'high',
  inputMethod: 'cadastral_reference',
  cadastralReference: '1234567NH4913S',
  normalizedAddress: 'Direccion oficial',
  coordinates: { lat: 43.3, lng: -8.2 },
  candidates: [],
  evidence: [
    {
      source: 'catastro',
      sourceUrl: 'https://official.test',
      retrievedAt: '2026-07-14T00:00:00.000Z',
      method: 'fixture',
    },
  ],
  warnings: [],
  conflicts: [],
  sourceChecks: [],
  planning: { status: 'not_determined', evidence: [], warnings: [] },
  affects: {
    analysisGeometry: 'point',
    detected: [],
    canRuleOutUndetectedAffects: false,
    warnings: [],
  },
  resolvedAt: '2026-07-14T00:00:00.000Z',
}

describe('resolveTerritorialContextAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.update.mockReturnValue({ set: mocks.set })
    mocks.set.mockReturnValue({ where: mocks.where })
    mocks.where.mockResolvedValue(undefined)
    mocks.getExpedienteAccess.mockResolvedValue({
      ok: true,
      userId: 'user-a',
      orgId: 'org-a',
      membershipRole: 'member',
      expediente: { id: 'exp-a', orgId: 'org-a' },
    })
    mocks.detectContextFromInput.mockResolvedValue(resolution)
    mocks.recordManualContext.mockResolvedValue(resolution)
  })

  it('no resuelve ni escribe un expediente no autorizado', async () => {
    mocks.getExpedienteAccess.mockResolvedValue({
      ok: false,
      reason: 'not_found_or_forbidden',
    })
    const form = new FormData()
    form.set('refCatastral', '1234567NH4913S')

    const result = await resolveTerritorialContextAction(
      'exp-b',
      { status: 'idle', message: '' },
      form
    )

    expect(result.status).toBe('error')
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.detectContextFromInput).not.toHaveBeenCalled()
  })

  it('autoriza, resuelve con las entradas permitidas y persiste solo el resultado oficial', async () => {
    const form = new FormData()
    form.set('refCatastral', '1234567-nh-4913-s')
    form.set('lat', '43.3')
    form.set('lng', '-8.2')
    form.set('address', 'Direccion orientativa')
    form.set('municipio', 'municipio-manipulado')

    const result = await resolveTerritorialContextAction(
      'exp-a',
      { status: 'idle', message: '' },
      form
    )

    expect(result.status).toBe('success')
    expect(mocks.detectContextFromInput).toHaveBeenCalledWith('exp-a', 'user-a', {
      cadastralReference: '1234567NH4913S',
      coordinates: { lat: 43.3, lng: -8.2 },
      address: 'Direccion orientativa',
    })
    expect(mocks.set).toHaveBeenCalledWith({
      refCatastral: '1234567NH4913S',
      address: 'Direccion oficial',
      lat: 43.3,
      lng: -8.2,
      location: [-8.2, 43.3],
      locationSource: 'cadastral_reference',
      contextoValidadoPorTecnico: false,
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/expedientes/exp-a')
  })

  it('no sobrescribe la ultima localizacion valida cuando Catastro falla', async () => {
    mocks.detectContextFromInput.mockResolvedValue({
      ...resolution,
      status: 'unresolved',
      confidence: 'low',
      evidence: [],
      sourceChecks: [
        {
          source: 'catastro',
          status: 'timeout',
          checkedAt: resolution.resolvedAt,
          message: 'Catastro no responde en este momento.',
        },
      ],
    })
    const form = new FormData()
    form.set('refCatastral', '1234567NH4913S')

    const result = await resolveTerritorialContextAction(
      'exp-a',
      { status: 'idle', message: '' },
      form
    )

    expect(result.message).toContain('Puedes reintentar')
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('guarda datos manuales trazables sin sustituir la localizacion oficial', async () => {
    mocks.recordManualContext.mockImplementation(async (_id, _user, _input, manualContext) => ({
      ...resolution,
      status: 'unresolved',
      evidence: [],
      continuity: {
        usingPreviousOfficialContext: false,
        sameParcelAsPrevious: false,
        manualContext,
      },
    }))
    const form = new FormData()
    form.set('intent', 'manual')
    form.set('manualMunicipality', 'Betanzos')
    form.set('manualClassification', 'Suelo urbano')
    form.set('manualOrdinance', 'Ordenanza 2')
    form.set('technicianValidated', 'on')

    const result = await resolveTerritorialContextAction(
      'exp-a',
      { status: 'idle', message: '' },
      form
    )

    expect(result.message).toMatch(/validados por el t.cnico/i)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.recordManualContext).toHaveBeenCalledWith(
      'exp-a',
      'user-a',
      expect.any(Object),
      expect.objectContaining({
        municipality: 'Betanzos',
        classification: 'Suelo urbano',
        ordinance: 'Ordenanza 2',
        provenance: 'manual',
        verification: 'technician_validated',
        validatedBy: 'user-a',
      })
    )
  })

  it('un viewer puede guardar provisional pero no declarar validacion tecnica', async () => {
    mocks.getExpedienteAccess.mockResolvedValue({
      ok: true,
      userId: 'viewer-a',
      orgId: 'org-a',
      membershipRole: 'viewer',
      expediente: { id: 'exp-a', orgId: 'org-a' },
    })
    const form = new FormData()
    form.set('intent', 'manual')
    form.set('manualMunicipality', 'Betanzos')
    form.set('technicianValidated', 'on')

    const result = await resolveTerritorialContextAction(
      'exp-a',
      { status: 'idle', message: '' },
      form
    )

    expect(result.status).toBe('error')
    expect(mocks.recordManualContext).not.toHaveBeenCalled()
  })
})
