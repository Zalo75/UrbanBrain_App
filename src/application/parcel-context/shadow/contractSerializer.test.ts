import { describe, it, expect } from 'vitest'
import { serializeTerritorialFactualContract } from './contractSerializer'
import type { TerritorialFactualContract } from '@/domain/parcel-context/factualContract'

describe('contractSerializer', () => {
  it('omite arrays y objetos vacios, y campos undefined', () => {
    const contract: TerritorialFactualContract = {
      identity: {
        municipalityName: 'Sada',
        address: undefined
      },
      scopes: {},
      classification: {
        status: 'unresolved',
        determination: 'unresolved'
      },
      categories: [],
      consolidation: {
        status: 'unresolved',
        determination: 'unresolved'
      },
      planningAreas: [],
      affects: {
        status: 'unresolved',
        items: []
      },
      normativeReferences: {}
    }

    const serialized = serializeTerritorialFactualContract(contract)
    const parsed = JSON.parse(serialized)

    expect(parsed.identity.address).toBeUndefined()
    expect(parsed.scopes).toBeUndefined()
    expect(parsed.categories).toBeUndefined()
    expect(parsed.planningAreas).toBeUndefined()
    expect(parsed.affects.items).toBeUndefined()
    expect(parsed.normativeReferences).toBeUndefined()
  })
})
