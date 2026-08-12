import { describe, it, expect } from 'vitest'
import { buildTerritorialFactualContract } from './buildFactualContract'
import type { NormalizedParcelContext } from '@/domain/parcel-context/types'

describe('Territorial Factual Contract', () => {

  it('CASO GOLDEN 1 - Sada: separa clasificación de múltiples categorías sin colapsar dimensiones ni inventar effective', () => {
    // Sada has SNR classification and 2 category candidates (SNRC, SNRT)
    const mockSadaContext: NormalizedParcelContext = {
      urbanisticFacts: {
        classification: {
          value: { code: 'SNR', label: 'Suelo de núcleo rural' },
          status: 'automatic_confirmed',
          origin: 'spatial_intersection',
          confidence: 'high',
          evidence: [{ source: 'siotuga', sourceUrl: '...', retrievedAt: '2023', method: 'intersection', scope: 'planning_classification' }],
          warnings: [],
          discrepancies: [],
          nextAction: 'none'
        },
        category: {
          status: 'conflict',
          origin: 'spatial_intersection',
          confidence: 'high',
          evidence: [{ source: 'siotuga', sourceUrl: '...', retrievedAt: '2023', method: 'intersection', scope: 'planning_classification' }],
          candidates: [
            { value: { code: 'SNRC', label: 'Núcleo rural común' }, parcelPercentage: 98.53, intersectionAreaSquareMetres: 1738 },
            { value: { code: 'SNRT', label: 'Núcleo rural tradicional' }, parcelPercentage: 1.47, intersectionAreaSquareMetres: 26 }
          ],
          warnings: [],
          discrepancies: [],
          nextAction: 'manual_selection'
        },
        consolidation: {
          status: 'not_available',
          confidence: 'unknown',
          evidence: [],
          warnings: [],
          discrepancies: [],
          nextAction: 'none'
        }
      },
      knownConstraints: [],
      conflicts: [],
      pendingValidation: []
    }

    const contract = buildTerritorialFactualContract(mockSadaContext)

    // 1. Classification is SNR and NOT duplicated as SNRC/SNRT
    expect(contract.classification.code).toBe('SNR')
    expect(contract.classification.determination).toBe('automatic')
    expect(contract.classification.provenance?.sourceName).toBe('siotuga')

    // 2. Categories contains exactly SNRC and SNRT with their percentages
    expect(contract.categories).toHaveLength(2)
    const snrc = contract.categories.find(c => c.code === 'SNRC')
    const snrt = contract.categories.find(c => c.code === 'SNRT')

    expect(snrc?.parcelPercentage).toBe(98.53)
    expect(snrt?.parcelPercentage).toBe(1.47)

    // 3. Status must remain 'conflict' and determination 'unresolved' (no fake 'effective')
    expect(snrc?.status).toBe('conflict')
    expect(snrc?.determination).toBe('unresolved')

    // 4. SNR does not appear as a category
    expect(contract.categories.find(c => c.code === 'SNR')).toBeUndefined()
  })

  it('CASO GOLDEN 2 - Betanzos: contexto complejo con múltiples elementos (sin WMS implícito)', () => {
    const mockBetanzosContext: NormalizedParcelContext = {
      cadastralReference: { value: '987654321', source: 'catastro', confidence: 1, verification: 'confirmed' },
      municipality: { value: { name: 'Betanzos', ineCode: '15009' }, source: 'catastro', confidence: 1, verification: 'confirmed' },
      urbanisticFacts: {
        classification: {
          value: { code: 'SU', label: 'Suelo Urbano' },
          status: 'automatic_confirmed',
          origin: 'spatial_intersection',
          confidence: 'high',
          evidence: [],
          warnings: [],
          discrepancies: [],
          nextAction: 'none'
        },
        category: {
          status: 'not_available',
          confidence: 'unknown',
          evidence: [],
          warnings: [],
          discrepancies: [],
          nextAction: 'none'
        },
        consolidation: {
          status: 'not_available',
          confidence: 'unknown',
          evidence: [],
          warnings: [],
          discrepancies: [],
          nextAction: 'none'
        }
      },
      knownConstraints: [
        { value: 'Patrimonio: Casco Histórico', source: 'ideg', confidence: 1, verification: 'confirmed', evidence: 'geom_intersection' }
      ],
      conflicts: [],
      pendingValidation: []
    }

    const contract = buildTerritorialFactualContract(mockBetanzosContext)

    expect(contract.identity.municipalityName).toBe('Betanzos')
    expect(contract.identity.cadastralReference).toBe('987654321')
    expect(contract.affects.status).toBe('checked')
    expect(contract.affects.items).toHaveLength(1)
    expect(contract.affects.items[0].label).toBe('Patrimonio: Casco Histórico')
    expect(contract.affects.items[0].determination).toBe('effective')
  })

  it('CASO GOLDEN 3 - Culleredo: resiliencia con parcelas completas sin depender de presentation/WMS', () => {
    const mockCulleredoContext: NormalizedParcelContext = {
      parcelSurfaceSquareMetres: 500,
      parcelGeometry: { type: 'MultiPolygon', coordinates: [], crs: 'EPSG:4326' },
      actionArea: {
        value: {
          id: '1',
          selectionType: 'detected_zone',
          surfaceSquareMetres: 200,
          parcelSurfaceSquareMetres: 500,
          geometry: { type: 'MultiPolygon', coordinates: [], crs: 'EPSG:4326' },
          source: 'user_polygon',
          confidence: 'high',
          selectedBy: 'user',
          selectedAt: 'now',
          verification: 'technician_validated'
        },
        source: 'manual',
        confidence: 1,
        verification: 'confirmed'
      },
      knownConstraints: [],
      conflicts: [],
      pendingValidation: []
    }

    const contract = buildTerritorialFactualContract(mockCulleredoContext)

    expect(contract.scopes.parcel?.hasGeometry).toBe(true)
    expect(contract.scopes.parcel?.areaSquareMetres).toBe(500)

    expect(contract.scopes.actionArea?.hasGeometry).toBe(true)
    expect(contract.scopes.actionArea?.areaSquareMetres).toBe(200)
    expect(contract.scopes.actionArea?.source).toBe('user_polygon')
  })

  it('CASO GOLDEN 4 - Arzúa: manejo honesto de unresolved sin fabricar datos', () => {
    const mockArzuaContext: NormalizedParcelContext = {
      municipality: { value: { name: 'Arzúa' }, source: 'catastro', confidence: 1, verification: 'confirmed' },
      planningInstrument: { value: 'NNSS', source: 'siotuga', confidence: 0.8, verification: 'inferred' },
      // urbanisticFacts missing intentionally (failed to fetch or not covered)
      knownConstraints: [],
      conflicts: [],
      pendingValidation: [],
      reliability: {
        mode: 'unresolved',
        sourceIssues: ['SIOTUGA timeout']
      }
    }

    const contract = buildTerritorialFactualContract(mockArzuaContext)

    expect(contract.identity.municipalityName).toBe('Arzúa')
    expect(contract.normativeReferences.planningInstrument).toBe('NNSS')

    // Classifications and categories should default to unresolved without fabricating fake 'no coverage' if it was a timeout
    expect(contract.classification.status).toBe('unresolved')
    expect(contract.classification.determination).toBe('unresolved')
    expect(contract.classification.code).toBeUndefined()

    expect(contract.categories).toHaveLength(0)

    // Affects should be unresolved because of global source issues
    expect(contract.affects.status).toBe('unresolved')
    expect(contract.affects.items).toHaveLength(0)
  })

  it('CASO SINTÉTICO A - manual override se convierte en effective', () => {
    const mockManualContext: NormalizedParcelContext = {
      urbanisticFacts: {
        classification: {
          value: { code: 'SU', label: 'Urbano' },
          status: 'technician_validated',
          origin: 'technician_confirmation',
          confidence: 'high',
          evidence: [],
          warnings: [],
          discrepancies: [],
          nextAction: 'none'
        },
        category: { status: 'not_available', confidence: 'unknown', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' },
        consolidation: { status: 'not_available', confidence: 'unknown', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' }
      },
      knownConstraints: [], conflicts: [], pendingValidation: []
    }

    const contract = buildTerritorialFactualContract(mockManualContext)

    expect(contract.classification.status).toBe('technician_validated')
    expect(contract.classification.determination).toBe('effective') // Must map manual validation to effective
    expect(contract.classification.provenance?.sourceType).toBe('manual')
  })

  it('CASO GOLDEN L2.5 - A. Consolidation preserve label y code', () => {
    const mockContext: NormalizedParcelContext = {
      urbanisticFacts: {
        classification: { status: 'not_available', confidence: 'unknown', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' },
        category: { status: 'not_available', confidence: 'unknown', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' },
        consolidation: {
          value: { code: 'consolidated', label: 'Suelo Urbano Consolidado' },
          status: 'automatic_confirmed',
          origin: 'spatial_intersection',
          confidence: 'high',
          evidence: [],
          warnings: [],
          discrepancies: [],
          nextAction: 'none'
        }
      },
      knownConstraints: [], conflicts: [], pendingValidation: []
    }

    const contract = buildTerritorialFactualContract(mockContext)
    expect(contract.consolidation.code).toBe('consolidated')
    expect(contract.consolidation.label).toBe('Suelo Urbano Consolidado')
  })

  it('CASO GOLDEN L2.5 - C. classification y category preserve label si existe', () => {
    const mockContext: NormalizedParcelContext = {
      urbanisticFacts: {
        classification: {
          value: { code: 'SNR', label: 'Suelo de núcleo rural' },
          status: 'automatic_confirmed',
          confidence: 'high', evidence: [], warnings: [], discrepancies: [], nextAction: 'none'
        },
        category: {
          status: 'conflict',
          confidence: 'high', evidence: [], warnings: [], discrepancies: [], nextAction: 'none',
          candidates: [
            { value: { code: 'SNRC', label: 'Núcleo rural común' }, parcelPercentage: 98.53, intersectionAreaSquareMetres: 1738 },
            { value: { code: 'SNRT' }, parcelPercentage: 1.47, intersectionAreaSquareMetres: 26 } // without label!
          ]
        },
        consolidation: { status: 'not_available', confidence: 'unknown', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' }
      },
      knownConstraints: [], conflicts: [], pendingValidation: []
    }

    const contract = buildTerritorialFactualContract(mockContext)
    expect(contract.classification.code).toBe('SNR')
    expect(contract.classification.label).toBe('Suelo de núcleo rural')

    const snrc = contract.categories.find(c => c.code === 'SNRC')
    expect(snrc?.label).toBe('Núcleo rural común') // preserve label

    const snrt = contract.categories.find(c => c.code === 'SNRT')
    expect(snrt?.label).toBeUndefined() // label undefined
  })

  it('L2.6 - A, B, C: Classification semanticCompleteness', () => {
    const build = (code?: string, label?: string) => buildTerritorialFactualContract({
      urbanisticFacts: {
        classification: {
          value: { code, label } as any,
          status: 'automatic_confirmed',
          origin: 'spatial_intersection',
          confidence: 'high', evidence: [], warnings: [], discrepancies: [], nextAction: 'none'
        },
        category: { status: 'not_available', confidence: 'unknown', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' },
        consolidation: { status: 'not_available', confidence: 'unknown', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' }
      },
      knownConstraints: [], conflicts: [], pendingValidation: []
    })

    // 1. classification code + label => complete
    expect(build('SU', 'Suelo Urbano').classification.semanticCompleteness).toBe('complete')

    // 2. classification code sin label => partial
    expect(build('SU', undefined).classification.semanticCompleteness).toBe('partial')

    // 3 y 4. classification con label "" o whitespace-only => partial
    expect(build('SU', '').classification.semanticCompleteness).toBe('partial')
    expect(build('SU', '   ').classification.semanticCompleteness).toBe('partial')
  })

  it('L2.6 - 5, 6, 7, 8, 9: Category and candidates semanticCompleteness', () => {
    const contract = buildTerritorialFactualContract({
      urbanisticFacts: {
        classification: { status: 'not_available', confidence: 'unknown', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' },
        category: {
          status: 'conflict',
          origin: 'spatial_intersection',
          confidence: 'high', evidence: [], warnings: [], discrepancies: [], nextAction: 'none',
          candidates: [
            { value: { code: 'A', label: 'Cat A' }, parcelPercentage: 50 }, // 8. candidate con label => complete
            { value: { code: 'B' } as any, parcelPercentage: 50 } // 9. candidate sin label => partial
          ]
        },
        consolidation: { status: 'not_available', confidence: 'unknown', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' }
      },
      knownConstraints: [], conflicts: [], pendingValidation: []
    })

    // 7. dos categorías simultáneas: una complete y otra partial
    const catA = contract.categories.find(c => c.code === 'A')
    const catB = contract.categories.find(c => c.code === 'B')

    expect(catA?.semanticCompleteness).toBe('complete') // 5 y 8. => complete
    expect(catB?.semanticCompleteness).toBe('partial') // 6 y 9. => partial
  })

  it('L2.6 - 10, 11: Consolidation semanticCompleteness', () => {
    const build = (code?: string, label?: string) => buildTerritorialFactualContract({
      urbanisticFacts: {
        classification: { status: 'not_available', confidence: 'unknown', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' },
        category: { status: 'not_available', confidence: 'unknown', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' },
        consolidation: {
          value: { code, label } as any,
          status: 'automatic_confirmed',
          origin: 'spatial_intersection',
          confidence: 'high', evidence: [], warnings: [], discrepancies: [], nextAction: 'none'
        }
      },
      knownConstraints: [], conflicts: [], pendingValidation: []
    })

    // 10. consolidation con label => complete
    expect(build('C', 'Consolidado').consolidation.semanticCompleteness).toBe('complete')

    // 11. consolidation sin label => partial
    expect(build('C', undefined).consolidation.semanticCompleteness).toBe('partial')
  })

  it('L2.6 - 12: PlanningArea semanticCompleteness', () => {
    const contract = buildTerritorialFactualContract({
      planningArea: { value: 'Z-1', source: 'siotuga', confidence: 1, verification: 'confirmed' },
      knownConstraints: [], conflicts: [], pendingValidation: []
    })
    // Planning area directly maps a string code without a label field in our implementation
    expect(contract.planningAreas[0].semanticCompleteness).toBe('partial')
  })

  it('L2.6 - TEST CRÍTICO DE ORTOGONALIDAD: semanticCompleteness = partial NO altera status ni determination', () => {
    const contract = buildTerritorialFactualContract({
      urbanisticFacts: {
        classification: {
          value: { code: 'SU' } as any, // no label -> partial
          status: 'technician_validated', // explicitly technician_validated (status)
          origin: 'technician_confirmation', // explicitly manual origin (=> determination: effective)
          confidence: 'high', evidence: [], warnings: [], discrepancies: [], nextAction: 'none'
        },
        category: { status: 'not_available', confidence: 'unknown', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' },
        consolidation: { status: 'not_available', confidence: 'unknown', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' }
      },
      knownConstraints: [], conflicts: [], pendingValidation: []
    })

    expect(contract.classification.semanticCompleteness).toBe('partial')
    // Check that status and determination are preserved exactly as they were
    expect(contract.classification.status).toBe('technician_validated')
    expect(contract.classification.determination).toBe('effective')
    expect(contract.classification.provenance?.sourceType).toBe('manual')
  })

  it('L2.6 - TEST CRÍTICO SNR: code: "SNR" label: undefined', () => {
    const contract = buildTerritorialFactualContract({
      urbanisticFacts: {
        classification: {
          value: { code: 'SNR', label: undefined },
          status: 'automatic_confirmed',
          origin: 'spatial_intersection',
          confidence: 'high', evidence: [], warnings: [], discrepancies: [], nextAction: 'none'
        },
        category: { status: 'not_available', confidence: 'unknown', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' },
        consolidation: { status: 'not_available', confidence: 'unknown', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' }
      },
      knownConstraints: [], conflicts: [], pendingValidation: []
    })

    expect(contract.classification.code).toBe('SNR')
    expect(contract.classification.label).toBeUndefined()
    expect(contract.classification.semanticCompleteness).toBe('partial')

    // El resultado NO debe contener las expansiones inventadas.
    const stringified = JSON.stringify(contract.classification)
    expect(stringified).not.toContain('Suelo no urbanizable')
    expect(stringified).not.toContain('Suelo de núcleo rural')
  })
})
