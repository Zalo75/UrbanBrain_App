import { describe, expect, it } from 'vitest'

import type {
  ApplicabilityResult,
  NormativeCandidate,
} from '@/domain/parcel-context/types'
import { buildNormalizedParcelContext } from './normalizeParcelContext'
import {
  buildAnswerContract,
  buildSafeAbstention,
  validateGeneratedAnswer,
} from './responseSafety'

const context = buildNormalizedParcelContext({
  expediente: {
    refCatastral: '1234567NH4913S0001AB',
    municipio: 'arteixo',
    landClass: 'urbano_consolidado',
    urbanPlanningZone: 'Z-4',
    planeamiento: 'PXOM de Arteixo',
    contextoValidadoPorTecnico: true,
  },
  detected: { planningStatus: 'vigente' },
})

const source: NormativeCandidate = {
  id: 'chunk-1',
  municipalityName: 'Arteixo',
  documentName: 'PXOM de Arteixo',
  title: 'Ordenanza Z-4',
  content: 'La altura máxima será de 7 m en la ordenanza Z-4.',
  hierarchy: 'ordenanza',
}

const determined: ApplicabilityResult = {
  status: 'DETERMINADO',
  applicable: [source],
  rejected: [],
  warnings: [],
  missingData: [],
  conflicts: [],
  canAnswerConcreteParameters: true,
}

describe('validateGeneratedAnswer', () => {
  it('acepta un parámetro determinado con cita y cifra presentes en la fuente', () => {
    const validation = validateGeneratedAnswer(
      'La altura máxima es de 7 m [Fuente 1].',
      [source],
      determined
    )

    expect(validation).toEqual({ valid: true, reasons: [], citations: [1] })
  })

  it('rechaza una cifra que no está soportada por la fuente citada', () => {
    const validation = validateGeneratedAnswer(
      'La altura máxima es de 9 m [Fuente 1].',
      [source],
      determined
    )

    expect(validation.valid).toBe(false)
    expect(validation.reasons.join(' ')).toMatch(/9m.*no aparece/i)
  })

  it('rechaza citas inexistentes para que fuentes visibles y corpus coincidan', () => {
    const validation = validateGeneratedAnswer(
      'La norma exige esta condición [Fuente 2].',
      [source],
      determined
    )

    expect(validation.valid).toBe(false)
    expect(validation.reasons).toContain('La respuesta cita una fuente inexistente.')
  })

  it('rechaza cifras cuando el régimen aplicable no está determinado', () => {
    const partial = { ...determined, status: 'PARCIAL' as const, canAnswerConcreteParameters: false }
    const validation = validateGeneratedAnswer(
      'La altura máxima es de 7 m [Fuente 1].',
      [source],
      partial
    )

    expect(validation.valid).toBe(false)
    expect(validation.reasons.join(' ')).toMatch(/cifras.*régimen/i)
  })

  it('mantiene el circuito CTE V2 con su propia fuente estatal', () => {
    const cteSource: NormativeCandidate = {
      id: 'cte-si-1',
      content: 'La resistencia al fuego será de 60 minutos.',
      documentName: 'CTE DB-SI',
      title: 'SI 6',
      hierarchy: 'estatal',
      sourceUrl: 'https://example.test/cte-si',
    }
    const cteApplicability = { ...determined, applicable: [cteSource] }

    const validation = validateGeneratedAnswer(
      'La resistencia exigida es de 60 minutos [Fuente 1].',
      [cteSource],
      cteApplicability
    )
    const contract = buildAnswerContract(
      'La resistencia exigida es de 60 minutos [Fuente 1].',
      context,
      cteApplicability,
      [1],
      [cteSource],
      'answer'
    )

    expect(validation.valid).toBe(true)
    expect(contract.hierarchy.estatal).toEqual(['CTE DB-SI'])
    expect(contract.hierarchy.municipal).toBeUndefined()
  })
})

describe('buildSafeAbstention', () => {
  it('indica el dato exacto que falta sin enumerar valores incompatibles', () => {
    const answer = buildSafeAbstention({
      ...determined,
      status: 'PARCIAL',
      applicable: [],
      missingData: ['calificación, ordenanza, ámbito o ficha'],
      canAnswerConcreteParameters: false,
    })

    expect(answer).toContain('calificación, ordenanza, ámbito o ficha')
    expect(answer).toContain('Me abstengo')
    expect(answer).not.toMatch(/7 m|9 m/)
  })
})
