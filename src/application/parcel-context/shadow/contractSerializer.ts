import type { TerritorialFactualContract } from '@/domain/parcel-context/factualContract'

export function serializeTerritorialFactualContract(contract: TerritorialFactualContract): string {
  // Solo exportamos factsByScope para el shadow pipeline si existe
  const target = contract.factsByScope
    ? { factsByScope: contract.factsByScope }
    : {
        classification: contract.classification,
        categories: contract.categories,
        consolidation: contract.consolidation,
        planningAreas: contract.planningAreas,
        affects: contract.affects
      }

  const serialized = JSON.stringify(target, (key, value) => {
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
