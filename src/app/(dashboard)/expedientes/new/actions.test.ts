import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUserId: vi.fn(),
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  returning: vi.fn(),
  detectStateless: vi.fn(),
  detectContext: vi.fn(),
  persistAuthorizedDetection: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('@/infrastructure/auth', () => ({ authProvider: { getUserId: mocks.getUserId } }))
vi.mock('@/infrastructure/db/client', () => ({ db: {
  select: mocks.select,
  insert: mocks.insert,
} }))
vi.mock('@/infrastructure/db/schema', () => ({
  expedientes: { id: 'id' },
  organizationMembers: { orgId: 'orgId', role: 'role', profileId: 'profileId' },
  municipalPlanning: { municipalityId: 'municipalityId', status: 'status', name: 'name' },
}))
vi.mock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/application/context-engine/ContextDetectionEngine', () => ({
  ContextDetectionEngine: class {
    detectStateless = mocks.detectStateless
    detectContext = mocks.detectContext
    persistAuthorizedDetection = mocks.persistAuthorizedDetection
  },
}))

import { createExpediente, initialCreateExpedienteState } from './actions'
import { storePreflightDetection } from './preflightDetectionCache'
import { summarizeSmartCaseDetection } from './smartCaseDetection'
import type { TerritorialResolution } from '@/domain/territorial-resolver/types'

const result: TerritorialResolution = {
  status: 'confirmed', confidence: 'high', inputMethod: 'cadastral_reference',
  cadastralReference: '7709702NH4970N0001SZ', parcelReference: '7709702NH4970N',
  normalizedAddress: 'LG LEDOÑO CULLEREDO (A CORUÑA)', municipality: 'Culleredo', municipalityCode: '15031', province: 'A Coruña', coordinates: { lat: 43.316, lng: -8.336 },
  candidates: [], evidence: [{ source: 'catastro', sourceUrl: 'https://official.test', retrievedAt: '2026-07-20T00:00:00.000Z', method: 'fixture' }], warnings: [], conflicts: [],
  planning: { status: 'determined', instrument: 'Plan general trazable', classification: { code: 'SU', label: 'Suelo urbano', sourceFeatureIds: ['class-1'] }, evidence: [], warnings: [] },
  affects: { analysisGeometry: 'parcel', detected: [], canRuleOutUndetectedAffects: false, warnings: [] },
  resolvedAt: '2026-07-20T00:00:00.000Z',
}

function form(detectionId: string) {
  const data = new FormData()
  data.set('name', 'Expediente de prueba')
  data.set('province', 'a_coruna')
  data.set('municipio', 'culleredo')
  data.set('refCatastral', '7709702NH4970N0001SZ')
  data.set('address', 'LG LEDOÑO CULLEREDO (A CORUÑA)')
  data.set('lat', '43.316')
  data.set('lng', '-8.336')
  data.set('planeamiento', 'Plan general trazable')
  data.set('landClass', 'urbano_consolidado')
  data.set('initialContextNoticeAccepted', 'true')
  data.set('preflightDetectionId', detectionId)
  return data
}

describe('createExpediente smart preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUserId.mockResolvedValue('user-a')
    mocks.select.mockReturnValue({ from: mocks.from })
    mocks.from.mockReturnValue({ where: mocks.where })
    mocks.where.mockReturnValue({ limit: mocks.limit })
    mocks.limit.mockResolvedValue([{ orgId: 'org-a', role: 'member' }])
    mocks.insert.mockReturnValue({ values: mocks.values })
    mocks.values.mockReturnValue({ returning: mocks.returning })
    mocks.returning.mockResolvedValue([{ id: 'exp-a' }])
    mocks.persistAuthorizedDetection.mockResolvedValue(true)
    mocks.redirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT') })
  })

  it('reuses a server-side preflight and persists normalized selections without repeating official queries', async () => {
    const detectionId = storePreflightDetection('user-a', summarizeSmartCaseDetection(result))

    await expect(createExpediente(initialCreateExpedienteState, form(detectionId))).rejects.toThrow('NEXT_REDIRECT')

    expect(mocks.detectStateless).not.toHaveBeenCalled()
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({
      province: 'a_coruna', municipio: 'culleredo', refCatastral: '7709702NH4970N0001SZ',
      planeamiento: 'Plan general trazable', landClass: 'urbano_consolidado',
    }))
    expect(mocks.persistAuthorizedDetection).toHaveBeenCalledWith('exp-a', 'user-a', result)
  })

  it('rejects client-side changes that conflict with the cached official result before writing', async () => {
    const detectionId = storePreflightDetection('user-a', summarizeSmartCaseDetection(result))
    const manipulated = form(detectionId)
    manipulated.set('municipio', 'abegondo')

    await expect(createExpediente(initialCreateExpedienteState, manipulated)).resolves.toMatchObject({
      status: 'error',
      field: 'municipio',
    })

    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.detectStateless).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('recalculates on a preflight cache miss instead of trusting the browser values', async () => {
    mocks.detectStateless.mockResolvedValue(result)

    await expect(createExpediente(initialCreateExpedienteState, form('expired-preflight'))).rejects.toThrow('NEXT_REDIRECT')

    expect(mocks.detectStateless).toHaveBeenCalledWith({ cadastralReference: '7709702NH4970N0001SZ' })
    expect(mocks.persistAuthorizedDetection).toHaveBeenCalledWith('exp-a', 'user-a', result)
  })

  it('marks an address mismatch on the address field instead of the cadastral reference', async () => {
    const detectionId = storePreflightDetection('user-a', summarizeSmartCaseDetection(result))
    const manipulated = form(detectionId)
    manipulated.set('address', 'Nueva dirección')

    await expect(createExpediente(initialCreateExpedienteState, manipulated)).resolves.toMatchObject({
      status: 'error',
      field: 'address',
    })
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('does not persist territorial values when the server cannot re-resolve an expired preflight', async () => {
    mocks.detectStateless.mockRejectedValue(new Error('official source unavailable'))

    await expect(createExpediente(initialCreateExpedienteState, form('expired-preflight'))).resolves.toMatchObject({
      status: 'error',
      field: 'refCatastral',
    })

    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.values).not.toHaveBeenCalled()
  })

  it('rejects a form explicitly marked as territorially invalidated before writing', async () => {
    const stale = form('')
    stale.set('territorialDetectionInvalidated', 'true')

    await expect(createExpediente(initialCreateExpedienteState, stale)).resolves.toMatchObject({
      status: 'error',
      field: 'territorialContext',
    })
    expect(mocks.detectStateless).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('returns a clear error without redirecting when a required value is missing', async () => {
    const incomplete = form('')
    incomplete.delete('name')

    await expect(createExpediente(initialCreateExpedienteState, incomplete)).resolves.toEqual({
      status: 'error',
      message: 'Indique un nombre para identificar el expediente.',
      field: 'name',
    })
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })
})
