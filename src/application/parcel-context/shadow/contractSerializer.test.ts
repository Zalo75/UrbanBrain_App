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

    expect(parsed.classification).toBeDefined()
    expect(parsed.classification.status).toBe('unresolved')

    // Estos campos deben ser omitidos (vacios)
    expect(parsed.categories).toBeUndefined()
    expect(parsed.planningAreas).toBeUndefined()

    // affects.items esta vacio y se quita, pero affects mantiene status
    expect(parsed.affects).toBeDefined()
    expect(parsed.affects.status).toBe('unresolved')
    expect(parsed.affects.items).toBeUndefined()
  })
})
