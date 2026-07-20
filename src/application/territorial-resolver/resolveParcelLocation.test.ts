import { describe, expect, it, vi } from 'vitest'

import {
  normalizeCadastralReference,
  resolveParcelLocation,
  type TerritorialResolverDependencies,
} from './resolveParcelLocation'
import type {
  AffectApplicability,
  CatastroParcel,
  PlanningApplicability,
  TerritorialEvidence,
  TerritorialLocationCandidate,
} from '@/domain/territorial-resolver/types'

const NOW = new Date('2026-07-13T12:00:00.000Z')
const evidence: TerritorialEvidence = {
  source: 'catastro',
  sourceUrl: 'https://official.test/catastro',
  retrievedAt: NOW.toISOString(),
  method: 'fixture',
}

function parcel(overrides: Partial<CatastroParcel> = {}): CatastroParcel {
  return {
    cadastralReference: '8424001NJ4082S',
    normalizedAddress: 'AV PEDRO BARRIE MAZA 19 A CORUÑA',
    municipality: 'A CORUÑA',
    municipalityCode: '15030',
    province: 'A CORUÑA',
    provinceCode: '15',
    coordinates: { lat: 43.371045, lng: -8.404096 },
    geometry: {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [-8.405, 43.37],
            [-8.404, 43.37],
            [-8.405, 43.37],
          ],
        ],
      ],
      crs: 'EPSG:4326',
    },
    evidence: [evidence],
    ...overrides,
  }
}

const noPlanning: PlanningApplicability = {
  status: 'not_determined',
  evidence: [],
  warnings: [{ code: 'planning_not_catalogued', message: 'No catalogado' }],
}
const noAffects: AffectApplicability = {
  analysisGeometry: 'parcel',
  detected: [],
  canRuleOutUndetectedAffects: false,
  warnings: [{ code: 'partial_affect_coverage', message: 'Cobertura parcial' }],
}

function dependencies(
  overrides: Partial<TerritorialResolverDependencies> = {}
): TerritorialResolverDependencies {
  return {
    catastro: {
      resolveReference: vi.fn(async () => parcel()),
      resolveCoordinates: vi.fn(async () => '8424001NJ4082S'),
    },
    geocoder: {
      geocode: vi.fn(async () => []),
      reverse: vi.fn(async () => null),
    },
    planning: { findApplicablePlanning: vi.fn(async () => noPlanning) },
    affects: { findAffects: vi.fn(async () => noAffects) },
    now: () => NOW,
    ...overrides,
  }
}

function cartoCandidate(
  overrides: Partial<TerritorialLocationCandidate> = {}
): TerritorialLocationCandidate {
  return {
    normalizedAddress: 'AV PEDRO BARRIE MAZA 19, A CORUÑA',
    municipality: 'A Coruña',
    municipalityCode: '15030',
    province: 'A Coruña',
    provinceCode: '15',
    coordinates: { lat: 43.371, lng: -8.404 },
    type: 'portal',
    evidence: [{ ...evidence, source: 'cartociudad' }],
    ...overrides,
  }
}

describe('resolveParcelLocation', () => {
  it('acepta referencias oficiales de 14, 18 y 20 caracteres', () => {
    expect(normalizeCadastralReference('8424001-NJ4082-S')).toBe('8424001NJ4082S')
    expect(normalizeCadastralReference('8424001NJ4082S0001')).toBe('8424001NJ4082S0001')
    expect(normalizeCadastralReference('8424001NJ4082S0001AY')).toBe('8424001NJ4082S0001AY')
  })

  it('prioriza la referencia catastral y devuelve ubicación y geometría trazables', async () => {
    const deps = dependencies()
    const result = await resolveParcelLocation(
      {
        cadastralReference: '8424001NJ4082S0001AY',
        coordinates: { lat: 43.371, lng: -8.404 },
        address: 'Pedro Barrie Maza 19',
      },
      deps
    )

    expect(result).toMatchObject({
      status: 'confirmed',
      confidence: 'high',
      inputMethod: 'cadastral_reference',
      cadastralReference: '8424001NJ4082S0001AY',
      parcelReference: '8424001NJ4082S',
      municipalityCode: '15030',
    })
    expect(result.parcelGeometry?.type).toBe('MultiPolygon')
    expect(deps.catastro.resolveCoordinates).not.toHaveBeenCalled()
    expect(result.evidence).toEqual([evidence])
    expect(deps.planning.findApplicablePlanning).toHaveBeenCalledWith({
      municipalityCode: '15030',
      coordinates: { lat: 43.371045, lng: -8.404096 },
      geometry: parcel().geometry,
    })
  })

  it('rechaza una referencia inválida sin consultar servicios externos', async () => {
    const deps = dependencies()
    const result = await resolveParcelLocation({ cadastralReference: 'ABC' }, deps)

    expect(result.status).toBe('unresolved')
    expect(result.warnings[0].code).toBe('invalid_cadastral_reference')
    expect(deps.catastro.resolveReference).not.toHaveBeenCalled()
  })

  it('resuelve coordenadas en Galicia contra Catastro', async () => {
    const result = await resolveParcelLocation(
      { coordinates: { lat: 43.371, lng: -8.404 } },
      dependencies()
    )
    expect(result.status).toBe('confirmed')
    expect(result.inputMethod).toBe('coordinates')
  })

  it('abstiene coordenadas fuera de la cobertura beta', async () => {
    const deps = dependencies()
    const result = await resolveParcelLocation(
      { coordinates: { lat: 40.4168, lng: -3.7038 } },
      deps
    )
    expect(result.status).toBe('unresolved')
    expect(result.warnings[0].code).toBe('outside_galicia_coverage')
    expect(deps.catastro.resolveCoordinates).not.toHaveBeenCalled()
  })

  it('mantiene sólo un punto probable si Catastro no identifica parcela', async () => {
    const deps = dependencies({
      catastro: {
        resolveReference: vi.fn(async () => null),
        resolveCoordinates: vi.fn(async () => null),
      },
      geocoder: {
        geocode: vi.fn(async () => []),
        reverse: vi.fn(async () => cartoCandidate()),
      },
    })
    const result = await resolveParcelLocation({ coordinates: { lat: 43.371, lng: -8.404 } }, deps)
    expect(result.status).toBe('probable')
    expect(result.parcelGeometry).toBeUndefined()
    expect(result.warnings.map((item) => item.code)).toContain('point_only_location')
  })

  it('confirma una dirección inequívoca sólo cuando puede contrastarla con Catastro', async () => {
    const deps = dependencies({
      geocoder: {
        geocode: vi.fn(async () => [cartoCandidate({ cadastralReference: '8424001NJ4082S' })]),
        reverse: vi.fn(async () => null),
      },
    })
    const result = await resolveParcelLocation({ address: 'dirección exacta' }, deps)
    expect(result.status).toBe('confirmed')
    expect(result.inputMethod).toBe('address')
  })

  it('no convierte una dirección única sin confirmación catastral en certeza', async () => {
    const deps = dependencies({
      geocoder: {
        geocode: vi.fn(async () => [cartoCandidate()]),
        reverse: vi.fn(async () => null),
      },
    })
    const result = await resolveParcelLocation({ address: 'dirección exacta' }, deps)
    expect(result.status).toBe('probable')
    expect(result.confidence).toBe('medium')
    expect(result.warnings.map((item) => item.code)).toContain('address_not_cadastrally_confirmed')
  })

  it('mantiene ambiguos múltiples candidatos y no consulta Catastro', async () => {
    const deps = dependencies({
      geocoder: {
        geocode: vi.fn(async () => [cartoCandidate(), cartoCandidate({ sourceId: '2' })]),
        reverse: vi.fn(async () => null),
      },
    })
    const result = await resolveParcelLocation({ address: 'Rúa Real' }, deps)
    expect(result.status).toBe('ambiguous')
    expect(result.candidates).toHaveLength(2)
    expect(deps.catastro.resolveReference).not.toHaveBeenCalled()
  })

  it('no acepta como ubicación un candidato sin coordenadas', async () => {
    const deps = dependencies({
      geocoder: {
        geocode: vi.fn(async () => [cartoCandidate({ coordinates: undefined, type: 'callejero' })]),
        reverse: vi.fn(async () => null),
      },
    })
    const result = await resolveParcelLocation({ address: 'Rúa Real' }, deps)
    expect(result.status).toBe('ambiguous')
    expect(result.warnings.map((item) => item.code)).toContain('address_candidate_has_no_point')
  })

  it('registra discrepancias de coordenadas, dirección y municipio sin sustituir Catastro', async () => {
    const result = await resolveParcelLocation(
      {
        cadastralReference: '8424001NJ4082S',
        coordinates: { lat: 42.8, lng: -8.5 },
        address: 'Otra calle 99',
        declaredMunicipality: 'Arteixo',
      },
      dependencies()
    )
    expect(result.conflicts.map((conflict) => conflict.field)).toEqual(
      expect.arrayContaining(['coordinates', 'address', 'municipality'])
    )
    expect(result.municipality).toBe('A CORUÑA')
  })

  it('no confirma datos que carecen de procedencia', async () => {
    const deps = dependencies({
      catastro: {
        resolveReference: vi.fn(async () => parcel({ evidence: [] })),
        resolveCoordinates: vi.fn(async () => null),
      },
    })
    const result = await resolveParcelLocation({ cadastralReference: '8424001NJ4082S' }, deps)
    expect(result.status).toBe('unresolved')
    expect(result.warnings[0].code).toBe('provenance_missing')
  })

  it.each(['caída', 'timeout', 'respuesta malformada'])(
    'se abstiene cuando la fuente externa falla: %s',
    async () => {
      const deps = dependencies({
        catastro: {
          resolveReference: vi.fn(async () => {
            throw new Error('external failure')
          }),
          resolveCoordinates: vi.fn(async () => null),
        },
      })
      const result = await resolveParcelLocation({ cadastralReference: '8424001NJ4082S' }, deps)
      expect(result.status).toBe('unresolved')
      expect(result.warnings[0].code).toBe('official_service_unavailable')
    }
  )

  it('continúa con geocodificación inversa si falla Catastro por coordenadas', async () => {
    const deps = dependencies({
      catastro: {
        resolveReference: vi.fn(async () => null),
        resolveCoordinates: vi.fn(async () => {
          throw new Error('timeout')
        }),
      },
      geocoder: {
        geocode: vi.fn(async () => []),
        reverse: vi.fn(async () => cartoCandidate()),
      },
    })
    const result = await resolveParcelLocation({ coordinates: { lat: 43.371, lng: -8.404 } }, deps)
    expect(result.status).toBe('probable')
    expect(result.warnings.map((item) => item.code)).toContain('catastro_coordinates_unavailable')
  })

  it('conserva la abstención si no puede determinar planeamiento o zona', async () => {
    const result = await resolveParcelLocation(
      { cadastralReference: '8424001NJ4082S' },
      dependencies()
    )
    expect(result.planning.status).toBe('not_determined')
    expect(result.planning.warnings[0].code).toBe('planning_not_catalogued')
  })

  it('conserva afecciones positivas y nunca usa una ausencia como descarte', async () => {
    const affect: AffectApplicability = {
      analysisGeometry: 'parcel',
      detected: [
        {
          category: 'patrimonio_cultural',
          name: 'BIC: contorno de protección',
          attributes: {},
          evidence: { ...evidence, source: 'ideg' },
          confidence: 'high',
        },
      ],
      canRuleOutUndetectedAffects: false,
      warnings: [],
    }
    const result = await resolveParcelLocation(
      { cadastralReference: '8424001NJ4082S' },
      dependencies({ affects: { findAffects: vi.fn(async () => affect) } })
    )
    expect(result.affects.detected[0].category).toBe('patrimonio_cultural')
    expect(result.affects.canRuleOutUndetectedAffects).toBe(false)
  })
})
