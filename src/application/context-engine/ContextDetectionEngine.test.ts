import { beforeEach, describe, expect, it, vi } from 'vitest'

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
import type { TerritorialResolution } from '@/domain/territorial-resolver/types'
import { buildNormalizedParcelContext } from '@/application/parcel-context/normalizeParcelContext'

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
    mocks.update.mockReturnValue({ set: mocks.set })
    mocks.set.mockReturnValue({ where: mocks.where })
    mocks.where.mockResolvedValue(undefined)
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

  it('solo persiste una deteccion previa cuando el nuevo expediente sigue autorizado', async () => {
    mocks.loadAuthorizedParcelInputs.mockResolvedValue(null)
    const engine = new ContextDetectionEngine(vi.fn(async () => resolution))

    await expect(engine.persistAuthorizedDetection('expediente-org-b', 'usuario-org-a', resolution)).resolves.toBe(false)
    expect(mocks.insert).not.toHaveBeenCalled()

    mocks.loadAuthorizedParcelInputs.mockResolvedValue({ expediente: { id: 'expediente-org-a' } })
    await expect(engine.persistAuthorizedDetection('expediente-org-a', 'usuario-org-a', resolution)).resolves.toBe(true)
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({ expedienteId: 'expediente-org-a' }))
    expect(mocks.set).toHaveBeenCalledWith({ status: 'active' })
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

  it('persiste la clase y el núcleo de Betanzos sin inventar una ordenanza', async () => {
    mocks.loadAuthorizedParcelInputs.mockResolvedValue({
      expediente: { id: 'expediente-org-a', orgId: 'org-a', municipio: 'betanzos' },
      detected: null,
      userMessages: [],
      constraints: [],
    })
    const betanzosResolution: TerritorialResolution = {
      ...resolution,
      municipality: 'Betanzos',
      municipalityCode: '15009',
      planning: {
        status: 'partial',
        instrument: 'Texto refundido de las Normas Subsidiarias',
        classification: {
          code: 'SNR',
          categoryCode: 'SNRSC',
          label: 'Suelo de núcleo rural',
          sourceFeatureIds: ['22221_1'],
        },
        areas: [{ type: 'nucleus', name: 'O CASTRO', sourceFeatureIds: ['22221_1'] }],
        applicableInstruments: [
          {
            id: '22221',
            name: 'Texto refundido de las Normas Subsidiarias',
            kind: 'Normas Subsidiarias',
            status: 'current',
            sourceUrl: 'https://siotuga.xunta.gal/',
          },
        ],
        canAnswerConcreteParameters: false,
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
    }

    await new ContextDetectionEngine(vi.fn(async () => betanzosResolution)).detectContext(
      'expediente-org-a',
      'usuario-org-a'
    )

    expect(mocks.values.mock.calls[0][0].summary).toMatchObject({
      planningStatus: 'vigente',
      planningApplicabilityStatus: 'partial',
      planningCanAnswerConcreteParameters: false,
      landClass: 'nucleo_rural',
      planningArea: 'O CASTRO',
    })
    expect(mocks.values.mock.calls[0][0].summary.qualification).toBeUndefined()
  })

  it('does not turn a detected work-area choice into a technician classification selection', async () => {
    mocks.loadAuthorizedParcelInputs.mockResolvedValue({
      expediente: { id: 'expediente-org-a', orgId: 'org-a' },
    })
    const selectedZone: TerritorialResolution = {
      ...resolution,
      municipality: 'Culleredo',
      municipalityCode: '15031',
      planning: {
        status: 'partial',
        instrument: 'PXOU',
        classification: {
          code: 'SU',
          categoryCode: 'SUSC',
          label: 'Suelo urbano',
          sourceFeatureIds: ['candidate-a'],
        },
        classificationResolution: {
          status: 'review_required',
          nextAction: 'review_official_sources',
          candidates: [{
            kind: 'official_classification',
            id: 'candidate-a',
            classification: {
              code: 'SU',
              categoryCode: 'SUSC',
              label: 'Suelo urbano',
              sourceFeatureIds: ['candidate-a'],
            },
            areas: [{ type: 'zone', name: 'LEDONO', sourceFeatureIds: ['candidate-a'] }],
            source: 'siotuga',
            evidence: [],
            confidence: 'high',
            evidenceBasis: 'parcel_geometry',
            instrumentTraceability: 'verified',
            normalizationStatus: 'mapped',
            parcelCoverage: {
              parcelAreaSquareMetres: 1000,
              intersectionAreaSquareMetres: 600,
              parcelPercentage: 60,
              method: 'polygon_intersection',
              intersectionGeometry: {
                type: 'MultiPolygon',
                crs: 'EPSG:4326',
                coordinates: [[[[-8.2, 43.2], [-8.19, 43.2], [-8.2, 43.21], [-8.2, 43.2]]]],
              },
            },
          }],
          discrepancies: [],
          reviewReasons: [],
          sourceChecks: [],
          officialLinks: [],
          evidence: [],
        },
        evidence: [],
        warnings: [],
      },
      continuity: {
        usingPreviousOfficialContext: false,
        sameParcelAsPrevious: true,
        manualContext: {
          provenance: 'manual',
          verification: 'unverified',
          recordedAt: '2026-08-06T10:00:00.000Z',
          actionAreaSelection: {
            history: [],
            current: {
              id: 'zone-a',
              selectionType: 'detected_zone',
              selectedCandidateId: 'candidate-a',
              geometry: {
                type: 'MultiPolygon',
                crs: 'EPSG:4326',
                coordinates: [[[[-8.2, 43.2], [-8.19, 43.2], [-8.2, 43.21], [-8.2, 43.2]]]],
              },
              surfaceSquareMetres: 600,
              parcelSurfaceSquareMetres: 1000,
              classification: 'SU',
              category: 'SUSC',
              planningZone: 'LEDONO',
              planningZones: ['LEDONO'],
              source: 'siotuga',
              confidence: 'high',
              selectedBy: 'architect-a',
              selectedAt: '2026-08-06T10:00:00.000Z',
              verification: 'unverified',
            },
          },
        },
      },
    }

    await new ContextDetectionEngine(vi.fn(async () => selectedZone)).persistAuthorizedDetection(
      'expediente-org-a',
      'usuario-org-a',
      selectedZone
    )

    const summary = mocks.values.mock.calls[0][0].summary
    expect(summary.classificationDetermination).toMatchObject({
      automatic: { value: 'urbano_no_consolidado', origin: 'automatic' },
    })
    expect(summary.classificationDetermination.technician).toBeUndefined()
    expect(summary.urbanisticFacts.classification).toMatchObject({
      status: 'manual_review_required',
      origin: 'spatial_intersection',
    })
  })

  it('keeps a pure exact detected zone automatic through the persisted chat snapshot', async () => {
    mocks.loadAuthorizedParcelInputs.mockResolvedValue({
      expediente: { id: 'expediente-exact', orgId: 'org-a' },
    })
    const exactResolution: TerritorialResolution = {
      ...resolution,
      municipality: 'Culleredo',
      municipalityCode: '15031',
      planning: {
        status: 'determined',
        instrument: 'PXOM de prueba',
        classification: {
          code: 'SNR',
          categoryCode: 'SNRC',
          label: 'Suelo de núcleo rural',
          categoryLabel: 'Núcleo rural común',
          sourceFeatureIds: ['exact-snr-common'],
        },
        classificationResolution: {
          status: 'clear',
          confidenceLevel: 'confirmed',
          nextAction: 'auto_accept',
          candidates: [{
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
                coordinates: [[[[-8.25, 43.35], [-8.24, 43.35], [-8.24, 43.36], [-8.25, 43.35]]]],
              },
            },
          }],
          discrepancies: [],
          reviewReasons: [],
          automaticSelection: {
            origin: 'automatic',
            candidateId: 'exact-snr-common',
            classificationCode: 'SNR',
            categoryCode: 'SNRC',
            areaNames: [],
            technicianValidated: false,
          },
          sourceChecks: [],
          officialLinks: [],
          evidence: [],
        },
        canAnswerConcreteParameters: true,
        applicableInstruments: [{
          id: '28089',
          name: 'PXOM de prueba',
          kind: 'PXOM',
          status: 'current',
          sourceUrl: 'https://official.test/planning.pdf',
        }],
        evidence: [{
          source: 'siotuga',
          sourceUrl: 'https://official.test/planning.pdf',
          retrievedAt: resolution.resolvedAt,
          method: 'fixture',
        }],
        warnings: [],
      },
      continuity: {
        usingPreviousOfficialContext: false,
        sameParcelAsPrevious: true,
        manualContext: {
          provenance: 'manual',
          verification: 'unverified',
          recordedAt: '2026-08-11T10:00:00.000Z',
          actionAreaSelection: {
            history: [],
            current: {
              id: 'selection-exact',
              selectionType: 'detected_zone',
              selectedCandidateId: 'exact-snr-common',
              geometry: {
                type: 'MultiPolygon',
                crs: 'EPSG:4326',
                coordinates: [[[[-8.25, 43.35], [-8.24, 43.35], [-8.24, 43.36], [-8.25, 43.35]]]],
              },
              surfaceSquareMetres: 1000,
              parcelSurfaceSquareMetres: 1000,
              classification: 'SNR',
              category: 'SNRC',
              planningZone: 'Núcleo rural común',
              planningZones: ['Núcleo rural común'],
              source: 'siotuga',
              confidence: 'high',
              selectedBy: 'architect-a',
              selectedAt: '2026-08-11T10:00:00.000Z',
              verification: 'unverified',
            },
          },
        },
      },
    }

    await new ContextDetectionEngine(vi.fn(async () => exactResolution)).persistAuthorizedDetection(
      'expediente-exact',
      'usuario-org-a',
      exactResolution
    )

    const summary = mocks.values.mock.calls[0][0].summary
    expect(summary).toMatchObject({
      actionAreaAutomaticallyConfirmed: true,
      planningApplicabilityStatus: 'determined',
      planningCanAnswerConcreteParameters: true,
      reliability: { mode: 'current_official' },
      planningArea: 'Núcleo rural común',
    })
    expect(summary.manualContext).toBeUndefined()
    expect(summary.actionAreaSelection).toBeUndefined()
    expect(summary.urbanisticFacts.classification.status).toBe('automatic_confirmed')
    expect(summary.urbanisticFacts.category.status).toBe('automatic_confirmed')

    const normalized = buildNormalizedParcelContext({
      expediente: {
        refCatastral: exactResolution.cadastralReference,
        municipio: 'culleredo',
        landClass: 'nucleo_rural',
        urbanPlanningZone: 'Núcleo rural común',
        planeamiento: 'PXOM de prueba',
      },
      detected: summary,
    })
    expect(normalized.canAnswerConcreteParameters).toBe(true)
    expect(normalized.landClass).toMatchObject({
      value: 'nucleo_rural',
      source: 'siotuga',
      verification: 'confirmed',
    })
    expect(normalized.planningArea).toMatchObject({
      value: 'Núcleo rural común',
      source: 'siotuga',
      verification: 'confirmed',
    })
    expect(normalized.pendingValidation).not.toContain(
      'El área de actuación seleccionada está pendiente de validación técnica.'
    )
    expect(normalized.actionArea).toBeUndefined()

    const currentOnly = { ...exactResolution, continuity: undefined }
    await new ContextDetectionEngine(vi.fn(async () => currentOnly)).persistAuthorizedDetection(
      'expediente-exact',
      'usuario-org-a',
      currentOnly
    )
    const currentSummary = mocks.values.mock.calls[1][0].summary
    expect(currentSummary).toMatchObject({
      actionAreaAutomaticallyConfirmed: true,
      planningArea: 'Núcleo rural común',
      classificationConfidenceLevel: 'confirmed',
      planningCanAnswerConcreteParameters: true,
    })
    expect(buildNormalizedParcelContext({
      expediente: {
        refCatastral: currentOnly.cadastralReference,
        municipio: 'culleredo',
        landClass: 'nucleo_rural',
        urbanPlanningZone: 'Núcleo rural común',
        planeamiento: 'PXOM de prueba',
      },
      detected: currentSummary,
    }).canAnswerConcreteParameters).toBe(true)

    const partialResolution: TerritorialResolution = {
      ...exactResolution,
      planning: { ...exactResolution.planning, status: 'partial' },
    }
    await new ContextDetectionEngine(vi.fn(async () => partialResolution)).persistAuthorizedDetection(
      'expediente-exact',
      'usuario-org-a',
      partialResolution
    )
    const partialSummary = mocks.values.mock.calls[2][0].summary
    expect(partialSummary).toMatchObject({
      actionAreaAutomaticallyConfirmed: false,
      planningApplicabilityStatus: 'partial',
      manualContext: expect.objectContaining({ verification: 'unverified' }),
    })

    const partialRecalculation: TerritorialResolution = {
      ...currentOnly,
      planning: {
        ...currentOnly.planning,
        status: 'partial',
        sourceChecks: [{
          source: 'siotuga',
          status: 'partial',
          checkedAt: '2026-08-11T12:00:00.000Z',
          message: 'El recálculo no completó la comprobación del planeamiento.',
        }],
      },
    }
    mocks.loadAuthorizedParcelInputs.mockResolvedValue({
      expediente: {
        id: 'expediente-exact',
        ownerId: 'owner-a',
        refCatastral: exactResolution.cadastralReference,
        address: null,
        lat: null,
        lng: null,
        municipio: 'culleredo',
      },
      latestDetectionRaw: exactResolution,
    })
    const recalculated = await new ContextDetectionEngine(
      vi.fn(async () => partialRecalculation)
    ).detectContext('expediente-exact', 'usuario-org-a')
    const recalculatedSummary = mocks.values.mock.calls[3][0].summary

    expect(recalculated?.continuity).toMatchObject({
      usingPreviousOfficialContext: true,
      manualContext: expect.objectContaining({ verification: 'unverified' }),
    })
    expect(recalculatedSummary).toMatchObject({
      actionAreaAutomaticallyConfirmed: false,
      planningApplicabilityStatus: 'partial',
      manualContext: expect.objectContaining({ verification: 'unverified' }),
      reliability: { usingPreviousOfficialContext: true },
    })
    expect(buildNormalizedParcelContext({
      expediente: {
        refCatastral: exactResolution.cadastralReference,
        municipio: 'culleredo',
        landClass: 'nucleo_rural',
        urbanPlanningZone: 'Núcleo rural común',
        planeamiento: 'PXOM de prueba',
      },
      detected: recalculatedSummary,
    }).canAnswerConcreteParameters).toBe(false)
  })
})
