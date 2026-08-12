import type { TerritorialFactualContract } from '@/domain/parcel-context/factualContract'

export function serializeTerritorialFactualContract(contract: TerritorialFactualContract): string {
  // We stringify with a custom replacer to omit empty arrays, empty objects, and undefined/null.
  const serialized = JSON.stringify(contract, (key, value) => {
    if (value === null || value === undefined) return undefined
    
    // Omit empty arrays
    if (Array.isArray(value) && value.length === 0) return undefined
    
    // Omit empty objects
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return undefined
    
    // Safety check just in case huge geometries slip in (though the contract shouldn't have them)
    if (key === 'coordinates' && Array.isArray(value)) return '[OMITTED GEOMETRY]'

    return value
  }, 2)

  return serialized
}
