import { describe, expect, it } from 'vitest'
import type { NormalizedParcelContext } from '@/domain/parcel-context/types'
import type { UrbanisticRegimeFacts } from '@/domain/territorial-resolver/types'
import { buildTerritorialFactualContract } from './buildFactualContract'

const geometry = {
  type: 'MultiPolygon' as const,
  coordinates: [[[[-8.1, 43.6], [-8.09, 43.6], [-8.09, 43.61], [-8.1, 43.6]]]],
  crs: 'EPSG:4326' as const,
}

function singleCategoryFacts(code: string): UrbanisticRegimeFacts {
  const base = {
    status: 'automatic_confirmed' as const,
    origin: 'spatial_intersection' as const,
    confidence: 'high' as const,
    evidence: [], warnings: [], discrepancies: [], nextAction: 'none' as const,
  }
  return {
    classification: { ...base, value: { code: 'SNR', label: 'Suelo de Núcleo Rural' } },
    category: { ...base, value: { code, label: code } },
    consolidation: {
      status: 'not_available', confidence: 'unknown', evidence: [], warnings: [],
      discrepancies: [], nextAction: 'none',
    },
  }
}

function valdovinoContext(): NormalizedParcelContext {
  const facts = singleCategoryFacts('SNRSC')
  return {
    cadastralReference: {
      value: '15088A034002230000HU', source: 'catastro', confidence: 1,
      verification: 'confirmed',
    },
    parcelGeometry: geometry,
    parcelSurfaceSquareMetres: 854.78,
    parcelUrbanisticFacts: facts,
    urbanisticFacts: singleCategoryFacts('SNRSC'),
    actionArea: {
      value: {
        id: 'valdovino-whole-parcel', geometry, surfaceSquareMetres: 854.78,
        parcelSurfaceSquareMetres: 854.78, selectionType: 'whole_parcel',
        source: 'parcel_geometry', confidence: 'high', selectedBy: 'system',
        selectedAt: '2026-08-15T08:00:00.000Z', verification: 'unverified',
      },
      source: 'urbanbrain', confidence: 1, verification: 'confirmed',
    },
    knownConstraints: [], parcelKnownConstraints: [], conflicts: [], pendingValidation: [],
  }
}

describe('territorial category coverage contract', () => {
  it('derives full for accredited Valdoviño whole-parcel SNRSC in each own scope', () => {
    const contract = buildTerritorialFactualContract(valdovinoContext())

    expect(contract.factsByScope?.parcel?.categories).toEqual([
      expect.objectContaining({ code: 'SNRSC', coverage: 'full' }),
    ])
    expect(contract.factsByScope?.actionArea?.categories).toEqual([
      expect.objectContaining({ code: 'SNRSC', coverage: 'full' }),
    ])
    expect(contract.factsByScope?.parcel?.categories?.[0].parcelPercentage).toBeUndefined()
  })

  it('does not infer parcel full from an actionArea fact alone', () => {
    const context = valdovinoContext()
    context.parcelUrbanisticFacts = undefined
    const contract = buildTerritorialFactualContract(context)

    expect(contract.factsByScope?.parcel?.categories).toBeUndefined()
    expect(contract.factsByScope?.actionArea?.categories?.[0].coverage).toBe('unknown')
  })

  it('keeps Sada multicategory percentages partial and never promotes dominance to full', () => {
    const context = valdovinoContext()
    context.parcelUrbanisticFacts = {
      ...singleCategoryFacts('SNRC'),
      category: {
        status: 'conflict', origin: 'spatial_intersection', confidence: 'high',
        evidence: [], warnings: [], discrepancies: [], nextAction: 'manual_selection',
        candidates: [
          { value: { code: 'SNRC', label: 'Núcleo Rural Común' }, parcelPercentage: 98.53 },
          { value: { code: 'SNRT', label: 'Núcleo Rural Tradicional' }, parcelPercentage: 1.47 },
        ],
      },
    }
    const contract = buildTerritorialFactualContract(context)

    expect(contract.factsByScope?.parcel?.categories).toEqual([
      expect.objectContaining({ code: 'SNRC', parcelPercentage: 98.53, coverage: 'partial' }),
      expect.objectContaining({ code: 'SNRT', parcelPercentage: 1.47, coverage: 'partial' }),
    ])
  })
})
