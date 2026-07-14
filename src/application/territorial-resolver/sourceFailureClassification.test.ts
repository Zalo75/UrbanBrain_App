import { describe, expect, it, vi } from 'vitest'

import type {
  AffectApplicability,
  CatastroParcel,
  PlanningApplicability,
} from '@/domain/territorial-resolver/types'
import { OfficialServiceError } from '@/infrastructure/territorial-resolver/officialHttp'
import {
  resolveParcelLocation,
  type TerritorialResolverDependencies,
} from './resolveParcelLocation'

const NOW = new Date('2026-07-14T10:00:00.000Z')
const parcel: CatastroParcel = {
  cadastralReference: '8424001NJ4082S',
  municipality: 'Betanzos',
  municipalityCode: '15009',
  coordinates: { lat: 43.28, lng: -8.26 },
  evidence: [
    {
      source: 'catastro',
      sourceUrl: 'https://official.test',
      retrievedAt: NOW.toISOString(),
      method: 'fixture',
    },
  ],
}
const planning: PlanningApplicability = {
  status: 'partial',
  instrument: 'Normas Subsidiarias',
  evidence: [],
  warnings: [],
}
const affects: AffectApplicability = {
  analysisGeometry: 'point',
  detected: [],
  canRuleOutUndetectedAffects: false,
  warnings: [],
}

function dependencies(
  overrides: Partial<TerritorialResolverDependencies> = {}
): TerritorialResolverDependencies {
  return {
    catastro: {
      resolveReference: vi.fn(async () => parcel),
      resolveCoordinates: vi.fn(async () => parcel.cadastralReference),
    },
    geocoder: {
      geocode: vi.fn(async () => []),
      reverse: vi.fn(async () => null),
    },
    planning: { findApplicablePlanning: vi.fn(async () => planning) },
    affects: { findAffects: vi.fn(async () => affects) },
    now: () => NOW,
    ...overrides,
  }
}

describe('official source failure classification', () => {
  it.each([
    ['timeout', 'timeout'],
    ['malformed', 'malformed'],
    ['unavailable', 'unavailable'],
  ] as const)('clasifica Catastro como %s', async (kind, expected) => {
    const result = await resolveParcelLocation(
      { cadastralReference: parcel.cadastralReference },
      dependencies({
        catastro: {
          resolveReference: vi.fn(async () => {
            throw new OfficialServiceError('Catastro', kind, 'internal detail')
          }),
          resolveCoordinates: vi.fn(async () => null),
        },
      })
    )

    expect(result.status).toBe('unresolved')
    expect(result.sourceChecks).toContainEqual(
      expect.objectContaining({ source: 'catastro', status: expected })
    )
  })

  it('distingue un dato legitimamente no encontrado', async () => {
    const result = await resolveParcelLocation(
      { cadastralReference: parcel.cadastralReference },
      dependencies({
        catastro: {
          resolveReference: vi.fn(async () => null),
          resolveCoordinates: vi.fn(async () => null),
        },
      })
    )

    expect(result.sourceChecks).toContainEqual(
      expect.objectContaining({ source: 'catastro', status: 'not_found' })
    )
    expect(result.sourceChecks?.some((check) => check.status === 'unavailable')).toBe(false)
  })

  it('no eleva a confianza alta una respuesta parcial de Catastro', async () => {
    const result = await resolveParcelLocation(
      { cadastralReference: parcel.cadastralReference },
      dependencies({
        catastro: {
          resolveReference: vi.fn(async () => ({
            ...parcel,
            sourceChecks: [
              {
                source: 'catastro',
                status: 'partial',
                checkedAt: NOW.toISOString(),
                message: 'Respuesta parcial.',
              },
            ],
          })),
          resolveCoordinates: vi.fn(async () => null),
        },
      })
    )

    expect(result.status).toBe('confirmed')
    expect(result.confidence).toBe('medium')
  })

  it('conserva Catastro si SIOTUGA cae', async () => {
    const result = await resolveParcelLocation(
      { cadastralReference: parcel.cadastralReference },
      dependencies({
        planning: {
          findApplicablePlanning: vi.fn(async () => {
            throw new OfficialServiceError('SIOTUGA', 'timeout', 'internal detail')
          }),
        },
      })
    )

    expect(result.status).toBe('confirmed')
    expect(result.cadastralReference).toBe(parcel.cadastralReference)
    expect(result.planning.sourceChecks).toContainEqual(
      expect.objectContaining({ source: 'siotuga', status: 'timeout' })
    )
  })

  it('conserva parcela y planeamiento si IDEG cae sin crear un falso negativo', async () => {
    const result = await resolveParcelLocation(
      { cadastralReference: parcel.cadastralReference },
      dependencies({
        affects: {
          findAffects: vi.fn(async () => {
            throw new OfficialServiceError('IDEG', 'unavailable', 'internal detail')
          }),
        },
      })
    )

    expect(result.status).toBe('confirmed')
    expect(result.affects.detected).toEqual([])
    expect(result.affects.canRuleOutUndetectedAffects).toBe(false)
    expect(result.affects.sourceChecks).toContainEqual(
      expect.objectContaining({ source: 'ideg', status: 'unavailable' })
    )
  })
})
