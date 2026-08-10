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
  loadAuthorizedParcelInputs: vi.fn(),
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
vi.mock('@/infrastructure/territorial-resolver/IdegAffectAdapter', () => ({
  IdegAffectAdapter: class {
    findAffects = vi.fn().mockResolvedValue([])
  }
}))
vi.mock('@/infrastructure/db/parcelContextRepository', () => ({
  loadAuthorizedParcelInputs: mocks.loadAuthorizedParcelInputs,
}))

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
    mocks.loadAuthorizedParcelInputs.mockResolvedValue({
      latestDetectionRaw: resolution,
      detected: {}
    })
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
    expect(mocks.detectContextFromInput).toHaveBeenCalledWith(
      'exp-a',
      'user-a',
      {
        cadastralReference: '1234567NH4913S',
        coordinates: { lat: 43.3, lng: -8.2 },
        address: 'Direccion orientativa',
      },
      expect.any(String)
    )
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

  it('usa el contexto oficial conservado cuando la respuesta actual es parcial', async () => {
    const previousOfficial = {
      ...resolution,
      normalizedAddress: 'Direccion oficial anterior',
      coordinates: { lat: 43.31, lng: -8.21 },
      resolvedAt: '2026-07-13T00:00:00.000Z',
    }
    mocks.detectContextFromInput.mockResolvedValue({
      ...resolution,
      normalizedAddress: undefined,
      coordinates: undefined,
      sourceChecks: [
        {
          source: 'catastro',
          status: 'partial',
          checkedAt: resolution.resolvedAt,
          message: 'Catastro solo pudo completar parte de la comprobacion.',
        },
      ],
      continuity: {
        lastOfficialContext: previousOfficial,
        effectiveOfficialContext: previousOfficial,
        usingPreviousOfficialContext: true,
        sameParcelAsPrevious: true,
      },
    })
    const form = new FormData()
    form.set('refCatastral', '1234567NH4913S')

    await resolveTerritorialContextAction(
      'exp-a',
      { status: 'idle', message: '' },
      form
    )

    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        address: 'Direccion oficial anterior',
        lat: 43.31,
        lng: -8.21,
        location: [-8.21, 43.31],
      })
    )
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
    form.set('refCatastral', '1234567NH4913S')
    form.set('manualMunicipality', 'Betanzos')
    form.set('manualClassification', 'Suelo urbano')
    form.set('manualOrdinance', 'Ordenanza 2')
    form.set('manualObservations', 'Comprobar alineaciones antes del proyecto')
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
        observations: 'Comprobar alineaciones antes del proyecto',
        provenance: 'manual',
        verification: 'technician_validated',
        validatedBy: 'user-a',
      })
    )
  })

  it('acepta observaciones manuales sin obligar a inventar municipio o zonificacion', async () => {
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
    form.set('refCatastral', '1234567NH4913S')
    form.set('manualObservations', 'Pendiente de visita al emplazamiento')
    form.set('provenance', 'catastro')
    form.set('verification', 'confirmed')

    const result = await resolveTerritorialContextAction(
      'exp-a',
      { status: 'idle', message: '' },
      form
    )

    expect(result.status).toBe('success')
    expect(mocks.recordManualContext).toHaveBeenCalledWith(
      'exp-a',
      'user-a',
      expect.any(Object),
      expect.objectContaining({
        observations: 'Pendiente de visita al emplazamiento',
        verification: 'unverified',
      })
    )
  })

  it('no expone detalles internos cuando el resolver falla inesperadamente', async () => {
    mocks.detectContextFromInput.mockRejectedValue(new Error('internal-sensitive-value'))
    const form = new FormData()
    form.set('refCatastral', '1234567NH4913S')

    const result = await resolveTerritorialContextAction(
      'exp-a',
      { status: 'idle', message: '' },
      form
    )

    expect(result).toEqual({
      status: 'error',
      message: 'No se ha podido completar la consulta territorial. Inténtelo de nuevo.',
    })
    expect(result.message).not.toContain('internal-sensitive-value')
  })

  it('impide que un viewer guarde contexto manual o declare validacion tecnica', async () => {
    mocks.getExpedienteAccess.mockResolvedValue({
      ok: true,
      userId: 'viewer-a',
      orgId: 'org-a',
      membershipRole: 'viewer',
      expediente: { id: 'exp-a', orgId: 'org-a' },
    })
    const form = new FormData()
    form.set('intent', 'manual')
    form.set('refCatastral', '1234567NH4913S')
    form.set('manualMunicipality', 'Betanzos')
    form.set('technicianValidated', 'on')

    const result = await resolveTerritorialContextAction(
      'exp-a',
      { status: 'idle', message: '' },
      form
    )

    expect(result.status).toBe('error')
    expect(result.message).toContain('permisos')
    expect(mocks.recordManualContext).not.toHaveBeenCalled()
  })

  it('rechaza un guardado manual si no se proporciona identidad de parcela (refCatastral o coordenadas completas)', async () => {
    const form = new FormData()
    form.set('intent', 'manual')
    form.set('manualMunicipality', 'Betanzos')
    // No set refCatastral, lat, lng

    const result = await resolveTerritorialContextAction(
      'exp-a',
      { status: 'idle', message: '' },
      form
    )

    expect(result.status).toBe('error')
    expect(result.message).toContain('No se puede guardar un contexto manual sin identificar la parcela')

    // Confirma que no llama al motor/repositorio
    expect(mocks.detectContextFromInput).not.toHaveBeenCalled()
    expect(mocks.recordManualContext).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('rechaza un guardado manual si lat/lng no son numéricos finitos ("abc")', async () => {
    const form = new FormData()
    form.set('intent', 'manual')
    form.set('lat', 'abc')
    form.set('lng', 'def')

    const result = await resolveTerritorialContextAction(
      'exp-a',
      { status: 'idle', message: '' },
      form
    )

    expect(result.status).toBe('error')
    expect(result.message).toContain('No se puede guardar un contexto manual sin identificar la parcela')

    expect(mocks.detectContextFromInput).not.toHaveBeenCalled()
    expect(mocks.recordManualContext).not.toHaveBeenCalled()
  })

  it('rechaza un guardado manual si solo se proporciona una coordenada', async () => {
    const form = new FormData()
    form.set('intent', 'manual')
    form.set('lat', '43.34')

    const result = await resolveTerritorialContextAction(
      'exp-a',
      { status: 'idle', message: '' },
      form
    )

    expect(result.status).toBe('error')
    expect(result.message).toContain('Latitud y longitud deben introducirse juntas')
    expect(mocks.recordManualContext).not.toHaveBeenCalled()
  })

  it('acepta un guardado manual con coordenadas 0,0 válidas (no se rechaza por truthiness)', async () => {
    mocks.recordManualContext.mockImplementation(async (_id, _user, _input, manualContext) => ({
      ...resolution,
      status: 'unresolved',
      evidence: [],
      continuity: { usingPreviousOfficialContext: false, sameParcelAsPrevious: false, manualContext },
    }))

    const form = new FormData()
    form.set('intent', 'manual')
    form.set('lat', '0')
    form.set('lng', '0')
    form.set('manualMunicipality', 'Null Island')

    const result = await resolveTerritorialContextAction(
      'exp-a',
      { status: 'idle', message: '' },
      form
    )

    expect(result.status).toBe('success')
    expect(mocks.recordManualContext).toHaveBeenCalledWith(
      'exp-a',
      'user-a',
      expect.objectContaining({ coordinates: { lat: 0, lng: 0 } }),
      expect.any(Object)
    )
  })

  it('rechaza un guardado manual si lat es Infinity y lng es válida', async () => {
    const form = new FormData()
    form.set('intent', 'manual')
    form.set('lat', 'Infinity')
    form.set('lng', '-8.26')

    const result = await resolveTerritorialContextAction(
      'exp-a',
      { status: 'idle', message: '' },
      form
    )

    expect(result.status).toBe('error')
    expect(result.message).toContain('No se puede guardar un contexto manual sin identificar la parcela')
    expect(mocks.detectContextFromInput).not.toHaveBeenCalled()
  })

  it('rechaza un guardado manual si lng es -Infinity y lat es válida', async () => {
    const form = new FormData()
    form.set('intent', 'manual')
    form.set('lat', '43.34')
    form.set('lng', '-Infinity')

    const result = await resolveTerritorialContextAction(
      'exp-a',
      { status: 'idle', message: '' },
      form
    )

    expect(result.status).toBe('error')
    expect(result.message).toContain('No se puede guardar un contexto manual sin identificar la parcela')
    expect(mocks.detectContextFromInput).not.toHaveBeenCalled()
  })

  it('rechaza un guardado manual si refCatastral son solo espacios y no hay coordenadas', async () => {
    const form = new FormData()
    form.set('intent', 'manual')
    form.set('refCatastral', '   ')

    const result = await resolveTerritorialContextAction(
      'exp-a',
      { status: 'idle', message: '' },
      form
    )

    expect(result.status).toBe('error')
    expect(result.message).toContain('No se puede guardar un contexto manual sin identificar la parcela')
    expect(mocks.detectContextFromInput).not.toHaveBeenCalled()
  })

  it('acepta un guardado manual solo con lat y lng finitos (sin refCatastral)', async () => {
    mocks.recordManualContext.mockImplementation(async (_id, _user, _input, manualContext) => ({
      ...resolution,
      status: 'unresolved',
      evidence: [],
      continuity: { usingPreviousOfficialContext: false, sameParcelAsPrevious: false, manualContext },
    }))

    const form = new FormData()
    form.set('intent', 'manual')
    form.set('lat', '43.34')
    form.set('lng', '-8.26')
    form.set('manualMunicipality', 'Sada')

    const result = await resolveTerritorialContextAction(
      'exp-a',
      { status: 'idle', message: '' },
      form
    )

    expect(result.status).toBe('success')
    expect(mocks.recordManualContext).toHaveBeenCalledWith(
      'exp-a',
      'user-a',
      expect.objectContaining({ coordinates: { lat: 43.34, lng: -8.26 } }),
      expect.any(Object)
    )
  })

  it('al enviar "Fijar como Zona de Trabajo" transmite actionAreaCandidateId y la identidad correctamente', async () => {
    mocks.recordManualContext.mockImplementation(async (_id, _user, _input, manualContext) => ({
      ...resolution,
      status: 'unresolved',
      evidence: [],
      continuity: { usingPreviousOfficialContext: false, sameParcelAsPrevious: false, manualContext },
    }))
    mocks.loadAuthorizedParcelInputs.mockResolvedValue({
      latestDetectionRaw: {
        ...resolution,
        planning: {
          status: 'partial',
          evidence: [],
          warnings: [],
          classificationResolution: {
            candidates: [
              {
                id: 'cand-1',
                areas: [],
                parcelCoverage: { intersectionGeometry: 'poly', surfaceSquareMetres: 100 }
              }
            ]
          }
        }
      },
      detected: {}
    })

    const form = new FormData()
    form.set('intent', 'manual')
    form.set('actionAreaMode', 'detected_zone')
    form.set('actionAreaEdited', '1')
    form.set('actionAreaCandidateId', 'cand-1')
    form.set('actionAreaValidated', 'on')
    form.set('refCatastral', '1234567NH4913S')
    form.set('lat', '43.1')
    form.set('lng', '-8.1')

    const result = await resolveTerritorialContextAction(
      'exp-a',
      { status: 'idle', message: '' },
      form
    )

    expect(result.status).toBe('success')
    expect(mocks.recordManualContext).toHaveBeenCalledWith(
      'exp-a',
      'user-a',
      expect.objectContaining({ cadastralReference: '1234567NH4913S', coordinates: { lat: 43.1, lng: -8.1 } }),
      expect.objectContaining({
        actionAreaSelection: expect.objectContaining({
          current: expect.objectContaining({
            selectedCandidateId: 'cand-1',
            verification: 'technician_validated'
          })
        })
      })
    )
  })
})
