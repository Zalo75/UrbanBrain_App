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
})
