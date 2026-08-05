import { describe, expect, it } from 'vitest'

import type {
  ApplicabilityResult,
  NormativeCandidate,
} from '@/domain/parcel-context/types'
import { buildNormalizedParcelContext } from './normalizeParcelContext'
import {
  buildAnswerContract,
  buildMunicipalSafetyPrompt,
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
      partial,
      'regime'
    )

    expect(validation.valid).toBe(false)
    expect(validation.reasons.join(' ')).toMatch(/cifras.*régimen/i)
  })

  it('permite cifras documentales citadas cuando la pregunta no depende del régimen de parcela', () => {
    const partial = { ...determined, status: 'PARCIAL' as const, canAnswerConcreteParameters: false }
    const validation = validateGeneratedAnswer(
      'El artículo citado establece una altura de 7 m [Fuente 1].',
      [source],
      partial,
      'independent'
    )

    expect(validation).toEqual({ valid: true, reasons: [], citations: [1] })
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

  it('acepta una respuesta mixta que responde lo documentado y se abstiene sólo del parámetro bloqueado', () => {
    const partial = { ...determined, status: 'PARCIAL' as const, canAnswerConcreteParameters: false }
    const mixedSource = {
      ...source,
      content: 'La parcela está afectada por la zona de protección de carreteras.',
    }

    const validation = validateGeneratedAnswer(
      'La parcela está afectada por la zona de protección de carreteras [Fuente 1]. No puedo determinar el retranqueo urbanístico sin clasificación y ordenanza confirmadas.',
      [mixedSource],
      partial,
      'mixed'
    )

    expect(validation).toEqual({ valid: true, reasons: [], citations: [1] })
  })

  it('rechaza en una respuesta mixta el parámetro afirmado sin régimen determinado', () => {
    const partial = { ...determined, status: 'PARCIAL' as const, canAnswerConcreteParameters: false }

    const validation = validateGeneratedAnswer(
      'La parcela está afectada por carreteras [Fuente 1]. El retranqueo urbanístico aplicable es de 3 m.',
      [source],
      partial,
      'mixed'
    )

    expect(validation.valid).toBe(false)
    expect(validation.reasons.join(' ')).toMatch(/parámetro de parcela sin régimen determinado/i)
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

  it('explica que existen disposiciones recuperadas cuando falta acreditar su aplicaci\u00f3n al \u00e1mbito', () => {
    const contextWithArea = buildNormalizedParcelContext({
      expediente: {
        refCatastral: '1234567NH4913S0001AB',
        municipio: 'arteixo',
        landClass: 'urbano_consolidado',
        urbanPlanningZone: '\u00c1mbito Z-4',
        planeamiento: 'PXOM de Arteixo',
      },
      detected: { planningStatus: 'vigente' },
    })
    const answer = buildSafeAbstention(
      {
        ...determined,
        status: 'PARCIAL',
        applicable: [],
        rejected: [{
          candidate: source,
          reason: 'El fragmento contiene una regulaci\u00f3n potencialmente relevante, pero no acredita su aplicaci\u00f3n al \u00e1mbito Z-4.',
        }],
        canAnswerConcreteParameters: false,
      },
      contextWithArea,
      '\u00bfCu\u00e1nto retranqueo hay que dejar?'
    )

    expect(answer).toContain('disposiciones sobre retranqueos')
    expect(answer).toContain('\u00e1mbito \u00c1mbito Z-4')
    expect(answer).not.toContain('No se ha recuperado evidencia documental suficiente')
    expect(answer).not.toMatch(/3 m|7 m/)
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
    expect(answer).toMatch(/Estado no determinado/i)
    expect(answer).toContain('COMPROBACIONES PENDIENTES')
    expect(answer).toContain('Comprobar otras afecciones sectoriales no cubiertas')
    expect(answer).toMatch(/abstengo únicamente.*clasificación.*planeamiento.*parámetros/i)
    expect(answer).not.toMatch(/edificabilidad\s*[:=]|altura\s*[:=]|ocupación\s*[:=]/i)
  })
})

describe('structured facts in prompts', () => {
  it('prefiere hechos V2 y conserva SUSC sin reducirlo a suelo urbano generico', () => {
    const contextWithFacts = buildNormalizedParcelContext({
      expediente: { planeamiento: 'PXOM de Culleredo' },
      detected: {
        municipalityName: 'Culleredo',
        municipalityCode: '15031',
        locationSource: 'catastro',
        locationStatus: 'confirmed',
        locationConfidence: 'high',
        planningInstrument: 'PXOM de Culleredo',
        planningArea: 'LEDOÃ‘O',
        urbanisticFacts: {
          classification: {
            value: { code: 'SU', label: 'Suelo urbano' },
            status: 'automatic_confirmed',
            confidence: 'high',
            evidence: [],
            warnings: [],
            discrepancies: [],
            nextAction: 'none',
            origin: 'spatial_intersection',
          },
          category: {
            value: { code: 'SUSC', label: 'Suelo urbano sin consolidar' },
            status: 'automatic_confirmed',
            confidence: 'high',
            evidence: [],
            warnings: [],
            discrepancies: [],
            nextAction: 'none',
            origin: 'spatial_intersection',
          },
          consolidation: {
            status: 'manual_review_required',
            confidence: 'unknown',
            evidence: [],
            warnings: [],
            discrepancies: [],
            nextAction: 'review_official_sources',
          },
        },
      },
    })

    const prompt = buildMunicipalSafetyPrompt(contextWithFacts, determined, [], 'independent')

    expect(prompt).toContain('HECHOS ESTRUCTURADOS DEL EXPEDIENTE')
    expect(prompt).toContain('Suelo urbano sin consolidar (SUSC)')
    expect(prompt).toContain('PXOM de Culleredo')
    expect(prompt).toContain('LEDOÃ‘O')
  })
})

describe('structured facts without normative evidence', () => {
  const contextWithFacts = buildNormalizedParcelContext({
    expediente: { planeamiento: 'PXOM de Culleredo' },
    detected: {
      municipalityName: 'Culleredo',
      municipalityCode: '15031',
      locationSource: 'catastro',
      locationStatus: 'confirmed',
      locationConfidence: 'high',
      planningInstrument: 'PXOM de Culleredo',
      urbanisticFacts: {
        classification: {
          value: { code: 'SU', label: 'Suelo urbano' },
          status: 'automatic_confirmed', confidence: 'high', evidence: [], warnings: [], discrepancies: [], nextAction: 'none',
        },
        category: {
          value: { code: 'SUSC', label: 'Suelo urbano sin consolidar' },
          status: 'automatic_confirmed', confidence: 'high', evidence: [], warnings: [], discrepancies: [], nextAction: 'none',
        },
        consolidation: {
          status: 'manual_review_required', confidence: 'unknown', evidence: [], warnings: [], discrepancies: [], nextAction: 'review_official_sources',
        },
      },
    },
  })
  const partial = { ...determined, status: 'PARCIAL' as const, applicable: [], canAnswerConcreteParameters: false }

  it('preserves valid facts in the limited abstention and omits irrelevant affects', () => {
    const answer = buildSafeAbstention(partial, contextWithFacts, 'Â¿Que implica la clasificacion urbanistica?')

    expect(answer).toContain('Suelo urbano sin consolidar (SUSC)')
    expect(answer).toContain('hechos territoriales estructurados válidos')
    expect(answer).not.toContain('Estado no determinado')
    expect(answer).not.toContain('AFECCIONES CONFIRMADAS')
  })

  it('accepts structured facts without a RAG citation but keeps normative assertions protected', () => {
    const structural = validateGeneratedAnswer(
      'El expediente identifica suelo urbano sin consolidar. No se ha recuperado evidencia documental suficiente para concretar sus consecuencias.',
      [source], partial, 'independent', contextWithFacts
    )
    const normative = validateGeneratedAnswer(
      'El expediente identifica suelo urbano sin consolidar. La norma permite licencia directa.',
      [source], partial, 'independent', contextWithFacts
    )
    const disguisedNormative = validateGeneratedAnswer(
      'La parcela clasificada como suelo urbano sin consolidar permite licencia directa.',
      [source], partial, 'independent', contextWithFacts
    )

    expect(structural.valid).toBe(true)
    expect(normative.valid).toBe(false)
    expect(normative.reasons).toContain('La respuesta no contiene citas.')
    expect(disguisedNormative.valid).toBe(false)
  })

  it('includes confirmed affects only when the question is about them', () => {
    const withAffect = { ...contextWithFacts, knownConstraints: [{ value: 'Carreteras: zona de proteccion', source: 'ideg' as const, confidence: 0.95, verification: 'confirmed' as const }] }
    const answer = buildSafeAbstention(partial, withAffect, 'Â¿Que afecciones tiene la parcela?')

    expect(answer).toContain('AFECCIONES CONFIRMADAS')
    expect(answer).toContain('Carreteras: zona de proteccion')
  })
})
