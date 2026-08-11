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
  update: vi.fn(),
  set: vi.fn(),
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
  update: mocks.update,
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

import { createExpediente, detectContextAction } from './actions'
import { initialCreateExpedienteState } from './creationState'
import { storePreflightDetection } from './preflightDetectionCache'
import { summarizeSmartCaseDetection } from './smartCaseDetection'
import type {
  TerritorialResolution,
  OfficialClassificationCandidate,
  DerivedUnmappedComplementCandidate,
  ParcelGeometry,
} from '@/domain/territorial-resolver/types'

const result: TerritorialResolution = {
  status: 'confirmed', confidence: 'high', inputMethod: 'cadastral_reference',
  cadastralReference: '7709702NH4970N0001SZ', parcelReference: '7709702NH4970N',
  normalizedAddress: 'LG LEDOÑO CULLEREDO (A CORUÑA)', municipality: 'Culleredo', municipalityCode: '15031', province: 'A Coruña', coordinates: { lat: 43.316, lng: -8.336 },
  candidates: [], evidence: [{ source: 'catastro', sourceUrl: 'https://official.test', retrievedAt: '2026-07-20T00:00:00.000Z', method: 'fixture' }], warnings: [], conflicts: [],
  planning: { status: 'determined', instrument: 'Plan general trazable', classification: { code: 'SU', label: 'Suelo urbano', sourceFeatureIds: ['class-1'] }, evidence: [], warnings: [] },
  affects: { analysisGeometry: 'parcel', detected: [], canRuleOutUndetectedAffects: false, warnings: [] },
  resolvedAt: '2026-07-20T00:00:00.000Z',
}

const intersectionGeometry: ParcelGeometry = {
  type: 'MultiPolygon',
  coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]],
  crs: 'EPSG:4326',
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
    mocks.update.mockReturnValue({ set: mocks.set })
    mocks.set.mockReturnValue({ where: mocks.where })
    mocks.persistAuthorizedDetection.mockResolvedValue(true)
    mocks.redirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT') })
  })

  it('reuses a server-side preflight and persists normalized selections without repeating official queries', async () => {
    const detectionId = storePreflightDetection('user-a', summarizeSmartCaseDetection(result))
    const submitted = form(detectionId)
    submitted.set('ownerId', 'attacker-controlled-user')

    await expect(createExpediente(initialCreateExpedienteState, submitted)).rejects.toThrow('NEXT_REDIRECT')

    expect(mocks.detectStateless).not.toHaveBeenCalled()
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'user-a',
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

    expect(mocks.detectStateless).toHaveBeenCalledWith({
      cadastralReference: '7709702NH4970N0001SZ',
    })
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

  it('does not persist planning or classification inherited from a stale form after an unresolved re-check', async () => {
    const unresolved = {
      ...result,
      planning: { status: 'not_determined' as const, evidence: [], warnings: [] },
    }
    mocks.detectStateless.mockResolvedValue(unresolved)

    await expect(createExpediente(initialCreateExpedienteState, form('expired-preflight'))).resolves.toMatchObject({
      status: 'error',
      field: 'planeamiento',
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

  it('resolves a coordinate-only preflight without requiring a cadastral reference', async () => {
    mocks.detectStateless.mockResolvedValue(result)
    const coordinateForm = form('')
    coordinateForm.delete('refCatastral')
    coordinateForm.set('lat', '43.316')
    coordinateForm.set('lng', '-8.336')

    const response = await detectContextAction(coordinateForm)

    expect(response).toHaveProperty('detectionId')
    expect(mocks.detectStateless).toHaveBeenCalledWith({
      coordinates: { lat: 43.316, lng: -8.336 },
    })
  })

  it('never forwards stale coordinates when a cadastral reference is the selected input', async () => {
    mocks.detectStateless.mockResolvedValue(result)
    const mixedForm = form('')
    mixedForm.set('territorialInputSource', 'cadastral_reference')
    mixedForm.set('lat', '43.270567277279795')
    mixedForm.set('lng', '-8.216584723963274')

    const response = await detectContextAction(mixedForm)

    expect(response).toHaveProperty('detectionId')
    expect(mocks.detectStateless).toHaveBeenCalledWith({
      cadastralReference: '7709702NH4970N0001SZ',
    })
  })

  it('uses only the selected address when a new address replaces prior parcel fields', async () => {
    mocks.detectStateless.mockResolvedValue(result)
    const addressForm = form('')
    addressForm.set('territorialInputSource', 'address')
    addressForm.set('address', 'Lugar nuevo, Culleredo')

    const response = await detectContextAction(addressForm)

    expect(response).toHaveProperty('detectionId')
    expect(mocks.detectStateless).toHaveBeenCalledWith({ address: 'Lugar nuevo, Culleredo' })
  })

  it('creates a coordinate-only case with the canonical values resolved by the server', async () => {
    const coordinateResult = {
      ...result,
      inputMethod: 'coordinates' as const,
      coordinates: { lat: 43.3161, lng: -8.3361 },
    }
    mocks.detectStateless.mockResolvedValue(coordinateResult)
    const coordinateForm = form('expired-preflight')
    coordinateForm.delete('refCatastral')
    coordinateForm.delete('address')
    coordinateForm.delete('planeamiento')
    coordinateForm.delete('landClass')

    await expect(createExpediente(initialCreateExpedienteState, coordinateForm)).rejects.toThrow('NEXT_REDIRECT')

    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({
      refCatastral: '7709702NH4970N0001SZ',
      province: 'a_coruna',
      municipio: 'culleredo',
      lat: 43.3161,
      lng: -8.3361,
    }))
  })

  it('rejects a non-empty invalid cadastral reference instead of silently discarding it', async () => {
    const invalid = form('')
    invalid.set('refCatastral', 'INVALIDA')

    await expect(createExpediente(initialCreateExpedienteState, invalid)).resolves.toMatchObject({
      status: 'error',
      field: 'refCatastral',
    })
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('keeps the expediente and marks its context pending when detection persistence fails', async () => {
    const detectionId = storePreflightDetection('user-a', summarizeSmartCaseDetection(result))
    mocks.persistAuthorizedDetection.mockRejectedValue(new Error('write failed'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(createExpediente(initialCreateExpedienteState, form(detectionId))).rejects.toThrow('NEXT_REDIRECT')

    expect(mocks.values).toHaveBeenCalled()
    expect(mocks.update).toHaveBeenCalled()
    expect(mocks.set).toHaveBeenCalledWith({ status: 'territorial_context_pending' })
    expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({
      event: 'territorial_context_persistence_failed',
      expedienteId: 'exp-a',
    }))
    errorSpy.mockRestore()
  })

  it('keeps an exact detected zone as the clear automatic selection without manual context', async () => {
    const candidate: OfficialClassificationCandidate = {
      kind: 'official_classification',
      id: 'exact-snr-common',
      classification: {
        code: 'SNR',
        categoryCode: 'SNRC',
        label: 'Suelo de núcleo rural',
        categoryLabel: 'Núcleo rural común',
        sourceFeatureIds: ['exact-snr-common'],
      },
      areas: [],
      source: 'siotuga',
      evidence: [],
      confidence: 'high',
      evidenceBasis: 'parcel_geometry',
      instrumentTraceability: 'verified',
      normalizationStatus: 'mapped',
      parcelCoverage: {
        parcelAreaSquareMetres: 1000,
        intersectionAreaSquareMetres: 1000,
        parcelPercentage: 100,
        method: 'polygon_intersection',
        intersectionGeometry: {
          type: 'MultiPolygon',
          crs: 'EPSG:4326',
          coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]],
        },
      },
    }
    const clearResult: TerritorialResolution = {
      ...result,
      planning: {
        ...result.planning,
        canAnswerConcreteParameters: true,
        classification: candidate.classification,
        classificationResolution: {
          status: 'clear',
          confidenceLevel: 'confirmed',
          nextAction: 'auto_accept',
          candidates: [candidate],
          discrepancies: [],
          reviewReasons: [],
          automaticSelection: {
            origin: 'automatic',
            candidateId: candidate.id,
            classificationCode: 'SNR',
            categoryCode: 'SNRC',
            areaNames: [],
            technicianValidated: false,
          },
          sourceChecks: [],
          officialLinks: [],
          evidence: [],
        },
      },
    }
    const detectionId = storePreflightDetection(
      'user-a',
      summarizeSmartCaseDetection(clearResult)
    )
    const submitted = form(detectionId)
    submitted.set('actionAreaMode', 'detected_zone')
    submitted.set('classificationCandidateId', candidate.id)
    submitted.set('landClass', 'nucleo_rural')
    submitted.set('urbanPlanningZone', 'Núcleo rural común')

    await expect(createExpediente(initialCreateExpedienteState, submitted)).rejects.toThrow(
      'NEXT_REDIRECT'
    )

    const persisted = mocks.persistAuthorizedDetection.mock.calls[0][2] as TerritorialResolution
    expect(persisted.continuity?.manualContext).toBeUndefined()
    expect(persisted.planning.classificationResolution?.finalSelection).toEqual(
      persisted.planning.classificationResolution?.automaticSelection
    )
    expect(persisted.planning.classificationResolution?.finalSelection?.origin).toBe('automatic')
    expect(persisted.planning.canAnswerConcreteParameters).toBe(true)
  })

  it('persists a reviewed manual selection separately from the automatic evidence', async () => {
    const candidate = {
      id: 'official-layer:SU|SUC',
      classification: {
        code: 'SU',
        categoryCode: 'SUC',
        label: 'Suelo urbano',
        sourceFeatureIds: ['feature-1'],
      },
      areas: [{ type: 'zone' as const, name: 'Zona oficial', sourceFeatureIds: ['feature-1'] }],
      source: 'siotuga' as const,
      evidence: [],
      confidence: 'medium' as const,
      evidenceBasis: 'parcel_geometry' as const,
      instrumentTraceability: 'pending' as const,
      normalizationStatus: 'mapped' as const,
    }
    const reviewResult: TerritorialResolution = {
      ...result,
      planning: {
        ...result.planning,
        classification: undefined,
        classificationResolution: {
          status: 'review_required',
          nextAction: 'review_official_sources',
          candidates: [candidate],
          discrepancies: [],
          reviewReasons: ['instrument_traceability_pending'],
          proposal: {
            candidateId: candidate.id,
            explanation: 'La capa requiere revisión.',
            confidence: 'medium',
            requiresProfessionalReview: true,
          },
          sourceChecks: [],
          officialLinks: [],
          evidence: [],
        },
      },
    }
    const detectionId = storePreflightDetection(
      'user-a',
      summarizeSmartCaseDetection(reviewResult)
    )
    const manual = form(detectionId)
    manual.set('classificationCandidateId', candidate.id)
    manual.set('classificationSelectionReason', 'Comprobado en el visor oficial por el técnico.')
    manual.set('urbanPlanningZone', 'Zona oficial')

    await expect(createExpediente(initialCreateExpedienteState, manual)).rejects.toThrow(
      'NEXT_REDIRECT'
    )

    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({ landClass: 'urbano_consolidado', urbanPlanningZone: 'Zona oficial' })
    )
    expect(mocks.persistAuthorizedDetection).toHaveBeenCalledWith(
      'exp-a',
      'user-a',
      expect.objectContaining({
        planning: expect.objectContaining({
          classification: undefined,
          classificationResolution: expect.objectContaining({
            proposal: expect.objectContaining({ candidateId: candidate.id }),
            finalSelection: expect.objectContaining({
              origin: 'manual',
              candidateId: candidate.id,
              operationalValue: 'urbano_consolidado',
              reason: 'Comprobado en el visor oficial por el técnico.',
            }),
          }),
        }),
      })
    )
  })
  it('persists a map-centric ActionAreaSelection reading directly from the candidate parcelCoverage', async () => {
    const candidate: OfficialClassificationCandidate = {
      kind: 'official_classification',
      id: 'candidate-snr',
      classification: {
        code: 'SNR',
        categoryCode: 'SNRSC',
        label: 'Suelo de Núcleo Rural',
        sourceFeatureIds: ['feature-snr'],
      },
      areas: [{ type: 'zone' as const, name: 'CASCAS', sourceFeatureIds: ['feature-snr'] }],
      source: 'siotuga' as const,
      evidence: [],
      confidence: 'high' as const,
      evidenceBasis: 'parcel_geometry' as const,
      instrumentTraceability: 'verified' as const,
      normalizationStatus: 'mapped' as const,
      parcelCoverage: {
        parcelAreaSquareMetres: 1000,
        intersectionAreaSquareMetres: 600,
        parcelPercentage: 60,
        method: 'polygon_intersection',
        intersectionGeometry,
      }
    }
    const reviewResult: TerritorialResolution = {
      ...result,
      planning: {
        ...result.planning,
        classificationResolution: {
          status: 'review_required',
          nextAction: 'review_official_sources',
          candidates: [candidate],
          discrepancies: [],
          reviewReasons: [],
          sourceChecks: [],
          officialLinks: [],
          evidence: [],
          proposal: {
            candidateId: candidate.id,
            explanation: 'La capa requiere revisión.',
            confidence: 'medium',
            requiresProfessionalReview: true,
          }
        },
      },
    }
    const detectionId = storePreflightDetection(
      'user-a',
      summarizeSmartCaseDetection(reviewResult)
    )
    const manual = form(detectionId)
    manual.set('actionAreaMode', 'detected_zone')
    manual.set('classificationCandidateId', candidate.id)
    manual.set('landClass', 'nucleo_rural')
    manual.set('classificationSelectionReason', 'Selección pendiente de revisión técnica.')

    await expect(createExpediente(initialCreateExpedienteState, manual)).rejects.toThrow(
      'NEXT_REDIRECT'
    )

    expect(mocks.persistAuthorizedDetection).toHaveBeenCalledWith(
      'exp-a',
      'user-a',
      expect.objectContaining({
        continuity: expect.objectContaining({
          manualContext: expect.objectContaining({
            actionAreaSelection: expect.objectContaining({
              current: expect.objectContaining({
                selectionType: 'detected_zone',
                selectedCandidateId: 'candidate-snr',
                classification: 'SNR',
                category: 'SNRSC',
                planningZone: 'CASCAS',
                planningZones: ['CASCAS'],
                geometry: candidate.parcelCoverage?.intersectionGeometry,
                surfaceSquareMetres: 600,
                parcelSurfaceSquareMetres: 1000,
                verification: 'unverified',
              })
            }),
            verification: 'unverified',
          })
        }),
      })
    )
  })

  it('persists planningZone from categoryLabel when candidate.areas is empty', async () => {
    const candidate: OfficialClassificationCandidate = {
      kind: 'official_classification',
      id: 'candidate-empty-areas',
      classification: {
        code: 'SNR',
        categoryCode: 'SNRSC',
        label: 'Suelo de Núcleo Rural',
        categoryLabel: 'Núcleo rural común',
        sourceFeatureIds: ['feature-snr'],
      },
      areas: [],
      source: 'siotuga' as const,
      evidence: [],
      confidence: 'high' as const,
      evidenceBasis: 'parcel_geometry' as const,
      instrumentTraceability: 'verified' as const,
      normalizationStatus: 'mapped' as const,
      parcelCoverage: {
        parcelAreaSquareMetres: 1000,
        intersectionAreaSquareMetres: 600,
        parcelPercentage: 60,
        method: 'polygon_intersection',
        intersectionGeometry,
      }
    }
    const reviewResult: TerritorialResolution = {
      ...result,
      planning: {
        ...result.planning,
        classificationResolution: {
          status: 'review_required',
          nextAction: 'review_official_sources',
          candidates: [candidate],
          discrepancies: [],
          reviewReasons: [],
          sourceChecks: [],
          officialLinks: [],
          evidence: [],
          proposal: {
            candidateId: candidate.id,
            explanation: 'La capa requiere revisión.',
            confidence: 'medium',
            requiresProfessionalReview: true,
          }
        },
      },
    }
    const detectionId = storePreflightDetection(
      'user-a',
      summarizeSmartCaseDetection(reviewResult)
    )
    const manual = form(detectionId)
    manual.set('actionAreaMode', 'detected_zone')
    manual.set('classificationCandidateId', candidate.id);
    manual.set('urbanPlanningZone', 'Núcleo rural común');
    manual.set('landClass', 'nucleo_rural')
    manual.set('classificationSelectionReason', 'Selección pendiente de revisión técnica.')

    await expect(createExpediente(initialCreateExpedienteState, manual)).rejects.toThrow(
      'NEXT_REDIRECT'
    )

    expect(mocks.persistAuthorizedDetection).toHaveBeenCalledWith(
      'exp-a',
      'user-a',
      expect.objectContaining({
        continuity: expect.objectContaining({
          manualContext: expect.objectContaining({
            actionAreaSelection: expect.objectContaining({
              current: expect.objectContaining({
                selectionType: 'detected_zone',
                selectedCandidateId: 'candidate-empty-areas',
                planningZone: 'Núcleo rural común',
                planningZones: ['Núcleo rural común'],
                verification: 'unverified',
              })
            })
          })
        })
      })
    )
  })

  it('persists a map-centric ActionAreaSelection for derived candidates without official classification', async () => {
    const candidate: DerivedUnmappedComplementCandidate = {
      kind: 'derived_unmapped_complement',
      id: 'candidate-complement',
      source: 'derived_geometry_complement',
      evidence: [],
      confidence: 'unknown',
      evidenceBasis: 'parcel_geometry',
      instrumentTraceability: 'pending',
      normalizationStatus: 'unmapped',
      areas: [],
      parcelCoverage: {
        parcelAreaSquareMetres: 1000,
        intersectionAreaSquareMetres: 400,
        parcelPercentage: 40,
        method: 'polygon_intersection',
        intersectionGeometry: {
          ...intersectionGeometry,
          coordinates: [[[[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]]]],
        },
      }
    }
    const reviewResult: TerritorialResolution = {
      ...result,
      planning: {
        ...result.planning,
        classificationResolution: {
          status: 'review_required',
          nextAction: 'review_official_sources',
          candidates: [candidate],
          discrepancies: [],
          reviewReasons: [],
          sourceChecks: [],
          officialLinks: [],
          evidence: [],
          proposal: {
            candidateId: candidate.id,
            explanation: 'La capa requiere revisión.',
            confidence: 'medium',
            requiresProfessionalReview: true,
          }
        },
      },
    }
    const detectionId = storePreflightDetection(
      'user-a',
      summarizeSmartCaseDetection(reviewResult)
    )
    const manual = form(detectionId)
    manual.set('actionAreaMode', 'detected_zone')
    manual.set('classificationCandidateId', candidate.id)
    manual.delete('landClass')
    manual.delete('urbanPlanningZone')

    await expect(createExpediente(initialCreateExpedienteState, manual)).rejects.toThrow(
      'NEXT_REDIRECT'
    )

    expect(mocks.persistAuthorizedDetection).toHaveBeenCalledWith(
      'exp-a',
      'user-a',
      expect.objectContaining({
        continuity: expect.objectContaining({
          manualContext: expect.objectContaining({
            actionAreaSelection: expect.objectContaining({
              current: expect.objectContaining({
                selectionType: 'detected_zone',
                selectedCandidateId: 'candidate-complement',
                classification: undefined,
                category: undefined,
                planningZone: undefined,
                planningZones: [],
                geometry: candidate.parcelCoverage.intersectionGeometry,
                surfaceSquareMetres: 400,
                parcelSurfaceSquareMetres: 1000,
              })
            })
          })
        }),
      })
    )
  })
})
