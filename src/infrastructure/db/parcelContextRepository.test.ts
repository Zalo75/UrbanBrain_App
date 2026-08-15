import { beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
}))

vi.mock('@/infrastructure/db/client', () => ({ db: { select: mocks.select } }))

import {
  buildAuthorizedExpedienteQuery,
  loadAuthorizedParcelInputs,
  urbanisticFactsFromRaw,
} from './parcelContextRepository'
import { buildTerritorialFactualContract } from '@/application/parcel-context/buildFactualContract'

describe('parcelContextRepository multitenancy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.select.mockReturnValue({ from: mocks.from })
    mocks.from.mockReturnValue({ where: mocks.where })
    mocks.where.mockReturnValue({ limit: mocks.limit })
  })

  it('no carga contexto ni historial cuando el usuario A no es propietario', async () => {
    mocks.limit.mockResolvedValue([])

    const result = await loadAuthorizedParcelInputs('expediente-org-b', 'user-org-a')

    expect(result).toBeNull()
    expect(mocks.select).toHaveBeenCalledOnce()
    expect(mocks.where).toHaveBeenCalledOnce()
  })

  it('genera un join que exige además la propiedad individual del expediente', () => {
    const database = drizzle.mock()
    const query = buildAuthorizedExpedienteQuery(
      database,
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111'
    ).toSQL()

    expect(query.sql).toContain('from "expedientes"')
    expect(query.sql).not.toContain('organization_members')
    expect(query.sql).toContain('"expedientes"."id" = $1')
    expect(query.sql).toContain('"expedientes"."owner_id" = $2')
    expect(query.params).toEqual([
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
      1,
    ])
  })
})

describe('urbanisticFactsFromRaw backwards compatibility', () => {
  it('A. hidrata candidatos desde classificationResolution en expedientes legacy con urbanisticFacts incompleto', () => {
    const rawLegacy = {
      planning: {
        urbanisticFacts: { classification: { status: 'conflict' } },
        classificationResolution: {
          candidates: [
            { kind: 'official_classification', classification: { code: 'SNR', categoryCode: 'SNRC' }, parcelCoverage: { parcelPercentage: 98.53, intersectionAreaSquareMetres: 1764.22 } },
            { kind: 'official_classification', classification: { code: 'SNR', categoryCode: 'SNRT' }, parcelCoverage: { parcelPercentage: 1.47, intersectionAreaSquareMetres: 26.33 } }
          ],
          discrepancies: [],
          evidence: []
        }
      }
    }

    const facts = urbanisticFactsFromRaw(rawLegacy)!


    expect(facts.classification.candidates).toBeDefined()
    expect(facts.classification.candidates!.length).toBe(2)
    expect(facts.category.candidates).toBeDefined()
    expect(facts.category.candidates!.length).toBe(2)
    expect(facts.classification.candidates![0].parcelPercentage).toBe(98.53)
  })

  it('B. expediente moderno mantiene facts completos (no regresion)', () => {
    const rawModern = {
      planning: {
        classificationResolution: {
          status: 'clear',
          candidates: [{ kind: 'official_classification', classification: { code: 'SU', categoryCode: 'SUC' } }],
          discrepancies: [],
          evidence: []
        }
      }
    }
    const facts = urbanisticFactsFromRaw(rawModern)!
    expect(facts.classification.value?.code).toBe('SU')
    expect(facts.category.value?.code).toBe('SUC')
  })

  it('C. fallback a urbanisticFacts legacy si no existe classificationResolution', () => {
    const rawLegacyNoResolution = {
      planning: {
        urbanisticFacts: { classification: { value: { code: 'SR' } } }
      }
    }
    const facts = urbanisticFactsFromRaw(rawLegacyNoResolution)!
    expect(facts.classification.value?.code).toBe('SR')
  })

  it('D. mantiene precedencia de decisiones manuales/effective via finalSelection', () => {
    const rawManual = {
      continuity: {
        effectiveOfficialContext: {
          planning: {
            classificationResolution: {
              status: 'clear',
              candidates: [
                { id: 'siotuga:1', kind: 'official_classification', classification: { code: 'SU', categoryCode: 'SUC' } },
                { id: 'siotuga:2', kind: 'official_classification', classification: { code: 'SNR', categoryCode: 'SNRC' } }
              ],
              finalSelection: {
                origin: 'technician_selection',
                candidateId: 'siotuga:2',
                classificationCode: 'SNR',
                categoryCode: 'SNRC',
                technicianValidated: true
              },
              discrepancies: [],
              evidence: []
            }
          }
        }
      }
    }
    const facts = urbanisticFactsFromRaw(rawManual)!

    expect(facts.classification.value?.code).toBe('SNR')
    expect(facts.category.value?.code).toBe('SNRC')
  })

  it('E. Sada realista: al reconstruir el contexto, clasificacion=SNR y categorias=SNRC/SNRT', () => {
    const rawSada = {
      planning: {
        urbanisticFacts: {
          classification: { status: 'conflict' },
          category: { status: 'conflict' }
        },
        classificationResolution: {
          status: 'multiple_intersections',
          candidates: [
            { kind: 'official_classification', classification: { code: 'SNR', categoryCode: 'SNRC', label: 'Núcleo', categoryLabel: 'Común' }, parcelCoverage: { parcelPercentage: 98.53 } },
            { kind: 'official_classification', classification: { code: 'SNR', categoryCode: 'SNRT', label: 'Núcleo', categoryLabel: 'Tradicional' }, parcelCoverage: { parcelPercentage: 1.47 } }
          ],
          discrepancies: [],
          evidence: []
        }
      }
    }
    const facts = urbanisticFactsFromRaw(rawSada)!

    expect(facts.classification.status).toBe('conflict')
    expect(facts.classification.candidates!.length).toBe(2)
    expect(facts.category.candidates!.length).toBe(2)
    expect(facts.classification.candidates![0].value.code).toBe('SNR')
    expect(facts.category.candidates![0].value.code).toBe('SNRC')
    expect(facts.category.candidates![1].value.code).toBe('SNRT')
  })

  it('F. hidrata duplicados legacy equivalentes sin convertirlos en competencia semántica', () => {
    const rawLegacy = {
      planning: {
        classificationResolution: {
          status: 'clear',
          candidates: [
            {
              id: 'legacy-source-1', kind: 'official_classification',
              classification: { code: 'SNR', categoryCode: 'SNRSC' },
              evidenceBasis: 'parcel_geometry', confidence: 'high', evidence: [],
            },
            {
              id: 'legacy-source-2', kind: 'official_classification',
              classification: { code: 'SNR', categoryCode: 'SNRSC' },
              evidenceBasis: 'parcel_geometry', confidence: 'high', evidence: [],
            },
          ],
          discrepancies: [], reviewReasons: [], evidence: [],
        },
      },
    }
    const facts = urbanisticFactsFromRaw(rawLegacy)!
    const geometry = {
      type: 'MultiPolygon' as const,
      coordinates: [[[[-8.1, 43.6], [-8.09, 43.6], [-8.1, 43.61], [-8.1, 43.6]]]],
      crs: 'EPSG:4326' as const,
    }

    const contract = buildTerritorialFactualContract({
      parcelGeometry: geometry,
      parcelSurfaceSquareMetres: 854.78,
      parcelUrbanisticFacts: facts,
      urbanisticFacts: facts,
      actionArea: {
        value: {
          id: 'whole', geometry, surfaceSquareMetres: 854.78,
          parcelSurfaceSquareMetres: 854.78, selectionType: 'whole_parcel',
          source: 'catastro', confidence: 'high', selectedBy: 'system',
          selectedAt: '2026-08-15T08:00:00.000Z', verification: 'unverified',
        },
        source: 'urbanbrain', confidence: 1, verification: 'confirmed',
      },
      knownConstraints: [], parcelKnownConstraints: [], conflicts: [], pendingValidation: [],
    })

    expect(facts.category.status).toBe('automatic_confirmed')
    expect(facts.category.candidates?.map((candidate) => candidate.value.code)).toEqual([
      'SNRSC', 'SNRSC',
    ])
    expect(contract.factsByScope?.parcel?.categories?.[0]).toEqual(expect.objectContaining({
      code: 'SNRSC', coverage: 'full',
    }))
  })
})
