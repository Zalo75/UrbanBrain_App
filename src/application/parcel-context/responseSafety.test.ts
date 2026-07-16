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

  it('comunica afecciones confirmadas por secciones aunque Betanzos tenga clasificación conflictiva', () => {
    const betanzosContext = buildNormalizedParcelContext({
      expediente: {},
      detected: {
        cadastralReference: '15009A01300255',
        municipalityName: 'Betanzos',
        municipalityId: 'betanzos',
        locationSource: 'catastro',
        locationStatus: 'confirmed',
        locationConfidence: 'high',
        planningApplicabilityStatus: 'conflict',
        planningCanAnswerConcreteParameters: false,
        planningConflicts: [
          'La parcela intersecta clases de suelo incompatibles y requiere validación geométrica.',
        ],
      },
      constraints: [
        {
          name: 'Patrimonio cultural: contorno de protección',
          source: 'ideg',
          confidence: 0.95,
          confirmed: true,
        },
        {
          name: 'Comprobar otras afecciones sectoriales no cubiertas',
          source: 'ideg',
          confidence: 0.55,
          confirmed: false,
        },
      ],
    })
    const conflictive: ApplicabilityResult = {
      ...determined,
      status: 'CONFLICTIVO',
      applicable: [],
      conflicts: betanzosContext.conflicts.map((conflict) => conflict.reason),
      missingData: ['clasificación del suelo', 'ordenanza o ámbito aplicable'],
      warnings: ['La cobertura automática de afecciones es parcial.'],
      canAnswerConcreteParameters: false,
    }

    const answer = buildSafeAbstention(conflictive, betanzosContext)

    expect(betanzosContext.cadastralReference?.value).toBe('15009A01300255')
    expect(answer).toContain('AFECCIONES CONFIRMADAS')
    expect(answer).toContain('Patrimonio cultural: contorno de protección')
    expect(answer).toContain('Fuente: ideg')
    expect(answer).toContain('Confianza: alta')
    expect(answer).toMatch(/cobertura parcial/i)
    expect(answer).toContain('CLASIFICACIÓN Y PLANEAMIENTO')
    expect(answer).toMatch(/Estado conflictivo/i)
    expect(answer).toContain('COMPROBACIONES PENDIENTES')
    expect(answer).toContain('Comprobar otras afecciones sectoriales no cubiertas')
    expect(answer).toMatch(/abstengo únicamente.*clasificación.*planeamiento.*parámetros/i)
    expect(answer).not.toMatch(/edificabilidad\s*[:=]|altura\s*[:=]|ocupación\s*[:=]/i)
  })
})
