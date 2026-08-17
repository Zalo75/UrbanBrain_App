import { describe, expect, it } from 'vitest'
import { buildMunicipalSafetyPrompt } from './responseSafety'
import type { NormalizedParcelContext } from '../../domain/parcel-context/types'

const baseContext: NormalizedParcelContext = {
  cadastralReference: { value: '123', verification: 'automatic_confirmed', source: 'official_document' },
  knownConstraints: [],
  conflicts: [],
  pendingValidation: []
}

describe('structuredFactLines / describeContext (multizone)', () => {
  const getPromptLines = (context: NormalizedParcelContext) => {
    const prompt = buildMunicipalSafetyPrompt(context, { status: 'DETERMINADO', missingData: [] }, [])
    const lines = prompt.split('\n')
    const start = lines.indexOf('HECHOS ESTRUCTURADOS DEL EXPEDIENTE')
    if (start === -1) return []
    const nextEmpty = lines.findIndex((l, i) => i > start && l.trim() === '')
    return lines.slice(start, nextEmpty === -1 ? undefined : nextEmpty)
  }

  it('1. Sada Multizona (SNRC 98.53%, SNRT 1.47%) - contiene ambos candidates y porcentajes', () => {
    const context: NormalizedParcelContext = {
      ...baseContext,
      urbanisticFacts: {
        classification: {
          value: { code: 'SNR', label: 'Suelo de Núcleo Rural' },
          status: 'automatic_confirmed',
          confidence: 'high',
          origin: 'spatial_intersection',
          evidence: [],
          warnings: [],
          discrepancies: [],
          nextAction: 'none'
        },
        category: {
          value: { code: 'SNRC', label: 'Núcleo rural común' },
          status: 'automatic_confirmed',
          confidence: 'high',
          origin: 'spatial_intersection',
          candidates: [
            { value: { code: 'SNRC', label: 'Núcleo rural común' }, parcelPercentage: 98.53 },
            { value: { code: 'SNRT', label: 'Núcleo rural tradicional' }, parcelPercentage: 1.47 }
          ],
          evidence: [],
          warnings: [],
          discrepancies: [],
          nextAction: 'none'
        },
        consolidation: { status: 'not_applicable', confidence: 'unknown', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' }
      }
    }
    const lines = getPromptLines(context)
    const text = lines.join('\n')
    expect(text).toContain('Categoría predominante/efectiva: Núcleo rural común (SNRC)')
    expect(text).toContain('Candidatos de categoría detectados (pluralidad territorial):')
    expect(text).toContain('Núcleo rural común (SNRC) - 98,53 % del área analizada')
    expect(text).toContain('Núcleo rural tradicional (SNRT) - 1,47 % del área analizada')
    expect(text).toContain('Estado espacial: HETEROGÉNEO (Pluralidad territorial detectada')
  })

  it('2. Predominance != Homogeneity', () => {
    const context: NormalizedParcelContext = {
      ...baseContext,
      urbanisticFacts: {
        classification: {
          value: { code: 'SNR', label: 'Suelo' },
          status: 'automatic_confirmed',
          confidence: 'high',
          evidence: [], warnings: [], discrepancies: [], nextAction: 'none'
        },
        category: {
          value: { code: 'SNRC' },
          status: 'automatic_confirmed',
          confidence: 'high',
          candidates: [
            { value: { code: 'SNRC' }, parcelPercentage: 98.53 },
            { value: { code: 'SNRT' }, parcelPercentage: 1.47 }
          ],
          evidence: [], warnings: [], discrepancies: [], nextAction: 'none'
        },
        consolidation: { status: 'not_applicable', confidence: 'unknown', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' }
      }
    }
    const text = getPromptLines(context).join('\n')
    // No debe serializar como único hecho territorial sin marcar pluralidad
    expect(text).not.toContain('Estado espacial: HOMOGÉNEO')
    expect(text).toContain('HETEROGÉNEO')
  })

  it('3. Single Zone (Valdoviño SNRSC 100%)', () => {
    const context: NormalizedParcelContext = {
      ...baseContext,
      urbanisticFacts: {
        classification: {
          value: { code: 'SNR', label: 'Suelo' },
          status: 'automatic_confirmed',
          confidence: 'high',
          evidence: [], warnings: [], discrepancies: [], nextAction: 'none'
        },
        category: {
          value: { code: 'SNRSC' },
          status: 'automatic_confirmed',
          confidence: 'high',
          candidates: [
            { value: { code: 'SNRSC' }, parcelPercentage: 100 }
          ],
          evidence: [], warnings: [], discrepancies: [], nextAction: 'none'
        },
        consolidation: { status: 'not_applicable', confidence: 'unknown', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' }
      }
    }
    const text = getPromptLines(context).join('\n')
    expect(text).toContain('Estado espacial: HOMOGÉNEO (Zona única detectada)')
    expect(text).not.toContain('HETEROGÉNEO')
    expect(text).not.toContain('Candidatos de categoría detectados (pluralidad territorial):')
  })

  it('4. Ames Manual Effective - prevalece manual sin perder homogeneidad/heterogeneidad', () => {
    const context: NormalizedParcelContext = {
      ...baseContext,
      urbanisticFacts: {
        classification: {
          value: { code: 'SR', label: 'Suelo Rústico' },
          status: 'technician_validated',
          origin: 'technician_confirmation',
          confidence: 'high',
          candidates: [{ value: { code: 'SR' }, parcelPercentage: 100 }],
          evidence: [], warnings: [], discrepancies: [], nextAction: 'none'
        },
        category: {
          value: { code: 'SRPA' },
          status: 'technician_validated',
          origin: 'technician_confirmation',
          confidence: 'high',
          candidates: [{ value: { code: 'SRPA' }, parcelPercentage: 100 }],
          evidence: [], warnings: [], discrepancies: [], nextAction: 'none'
        },
        consolidation: { status: 'not_applicable', confidence: 'unknown', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' }
      }
    }
    const text = getPromptLines(context).join('\n')
    expect(text).toContain('Estado: validado por técnico')
    expect(text).toContain('Procedencia: confirmación técnica')
    expect(text).toContain('Estado espacial: HOMOGÉNEO')
  })

  it('5. Conflict - se maneja correctamente', () => {
    const context: NormalizedParcelContext = {
      ...baseContext,
      urbanisticFacts: {
        classification: {
          value: { code: 'SU' },
          status: 'automatic_confirmed',
          confidence: 'high',
          evidence: [], warnings: [], discrepancies: [], nextAction: 'none'
        },
        category: {
          value: { code: 'SU' },
          status: 'conflict',
          confidence: 'unknown',
          evidence: [], warnings: [], discrepancies: [], nextAction: 'none'
        },
        consolidation: { status: 'not_applicable', confidence: 'unknown', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' }
      }
    }
    const text = getPromptLines(context).join('\n')
    expect(text).not.toContain('Categoría')
  })

  it('6 & 7. Area Selection vs Whole Parcel', () => {
    const contextArea: NormalizedParcelContext = {
      ...baseContext,
      actionArea: { value: { selectionType: 'user_polygon', surfaceSquareMetres: 150, geometry: {type:'Polygon',coordinates:[]}, verification:'unverified' }, source: 'implicit_planning_background', verification: 'unverified' },
      urbanisticFacts: {
        classification: { value: { code: 'SU' }, status: 'automatic_confirmed', confidence: 'high', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' },
        category: { value: { code: 'SU' }, status: 'automatic_confirmed', confidence: 'high', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' },
        consolidation: { status: 'not_applicable', confidence: 'unknown', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' }
      }
    }
    const textArea = getPromptLines(contextArea).join('\n')
    expect(textArea).toContain('Área de actuación: 150 m²')
    expect(textArea).toContain('alcance área delimitada por el usuario')

    const contextWhole: NormalizedParcelContext = {
      ...baseContext,
      urbanisticFacts: {
        classification: { value: { code: 'SU' }, status: 'automatic_confirmed', confidence: 'high', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' },
        category: { value: { code: 'SU' }, status: 'automatic_confirmed', confidence: 'high', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' },
        consolidation: { status: 'not_applicable', confidence: 'unknown', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' }
      }
    }
    const textWhole = getPromptLines(contextWhole).join('\n')
    expect(textWhole).toContain('Área de actuación: no seleccionada')
  })

  it('8. Serializer Roundtrip & 9. No Legacy Collapse', () => {
    const context: NormalizedParcelContext = {
      ...baseContext,
      urbanisticFacts: {
        classification: {
          value: { code: 'SNR' },
          status: 'automatic_confirmed',
          confidence: 'high',
          evidence: [], warnings: [], discrepancies: [], nextAction: 'none'
        },
        category: {
          value: { code: 'SNRC' }, // valor legacy consolidado
          status: 'automatic_confirmed',
          confidence: 'high',
          candidates: [
            { value: { code: 'SNRC' }, parcelPercentage: 80 },
            { value: { code: 'SNRT' }, parcelPercentage: 20 }
          ], // candidatos no colapsados
          evidence: [], warnings: [], discrepancies: [], nextAction: 'none'
        },
        consolidation: { status: 'not_applicable', confidence: 'unknown', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' }
      }
    }
    const text = getPromptLines(context).join('\n')
    expect(text).toContain('80 %')
    expect(text).toContain('20 %')
    expect(text).toContain('HETEROGÉNEO')
  })

  it('10. Legacy Compatibility - expediente sin candidates', () => {
    const context: NormalizedParcelContext = {
      ...baseContext,
      urbanisticFacts: {
        classification: {
          value: { code: 'SNR', label: 'Suelo' },
          status: 'automatic_confirmed',
          confidence: 'high',
          evidence: [], warnings: [], discrepancies: [], nextAction: 'none'
        },
        category: {
          value: { code: 'SNRC', label: 'Comun' },
          status: 'automatic_confirmed',
          confidence: 'high',
          evidence: [], warnings: [], discrepancies: [], nextAction: 'none'
          // sin candidates
        },
        consolidation: { status: 'not_applicable', confidence: 'unknown', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' }
      }
    }
    const text = getPromptLines(context).join('\n')
    // No debe fallar y debe mostrar el valor
    expect(text).toContain('Categoría: Comun (SNRC)')
    expect(text).toContain('Estado espacial: HOMOGÉNEO')
  })
})
