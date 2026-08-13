import { describe, expect, it } from 'vitest'

import type {
  ApplicabilityResult,
  NormalizedParcelContext,
  NormativeCandidate,
} from '@/domain/parcel-context/types'
import type { UrbanisticFactStatus, UrbanisticRegimeFacts } from '@/domain/territorial-resolver/types'
import { buildNormalizedParcelContext } from './normalizeParcelContext'
import {
  buildAnswerContract,
  buildMunicipalSafetyPrompt,
  buildSafeAbstention,
  validateGeneratedAnswer,
  buildStructuredParcelFactAnswer,
  sanitizeTechnicalPlaceholders,
} from './responseSafety'

describe('sanitizeTechnicalPlaceholders', () => {
  it('removes unmistakable technical placeholders before persistence', () => {
    expect(sanitizeTechnicalPlaceholders('Dato [undefined], otro [Fuente undefined], tercero [null] y [Fuente 1]. [contexto]'))
      .toBe('Dato, otro, tercero y [Fuente 1]. [contexto]')
  })

  it('preserves legitimate bracketed prose', () => {
    expect(sanitizeTechnicalPlaceholders('Valor [orientativo] y artículo [bis].'))
      .toBe('Valor [orientativo] y artículo [bis].')
  })
})

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

function regimeFacts(status: UrbanisticFactStatus): UrbanisticRegimeFacts {
  return {
    classification: {
      value: { code: 'SNR', label: 'Suelo de núcleo rural' },
      status,
      confidence: status === 'automatic_confirmed' ? 'high' : 'unknown',
      evidence: [],
      warnings: [],
      discrepancies: [],
      nextAction: status === 'automatic_confirmed' ? 'none' : 'review_official_sources',
    },
    category: {
      value: { code: 'SNRC', label: 'Núcleo Rural Común' },
      status,
      confidence: status === 'automatic_confirmed' ? 'high' : 'unknown',
      evidence: [],
      warnings: [],
      discrepancies: [],
      nextAction: status === 'automatic_confirmed' ? 'none' : 'review_official_sources',
    },
    consolidation: {
      status: 'not_available',
      confidence: 'unknown',
      evidence: [],
      warnings: [],
      discrepancies: [],
      nextAction: 'none',
    },
  }
}

function confirmationContext({
  parcelStatus,
  actionAreaStatus,
  reliabilityMode,
}: {
  parcelStatus?: UrbanisticFactStatus
  actionAreaStatus?: UrbanisticFactStatus
  reliabilityMode?: NonNullable<NormalizedParcelContext['reliability']>['mode']
}): NormalizedParcelContext {
  return {
    parcelUrbanisticFacts: parcelStatus ? regimeFacts(parcelStatus) : undefined,
    urbanisticFacts: actionAreaStatus
      ? regimeFacts(actionAreaStatus)
      : parcelStatus
        ? regimeFacts(parcelStatus)
        : undefined,
    actionArea: actionAreaStatus
      ? {
          value: {
            id: 'area-1',
            geometry: { type: 'MultiPolygon', coordinates: [], crs: 'EPSG:4326' },
            surfaceSquareMetres: 800,
            parcelSurfaceSquareMetres: 1800,
            selectionType: 'detected_zone',
            classification: 'SNR',
            category: 'SNRC',
            source: 'manual',
            confidence: 'high',
            selectedBy: 'technician',
            selectedAt: '2026-08-13T10:00:00.000Z',
            verification: actionAreaStatus === 'technician_validated' ? 'confirmed' : 'unresolved',
          },
          source: 'manual',
          confidence: 0.8,
          verification: actionAreaStatus === 'technician_validated' ? 'confirmed' : 'unverified',
        }
      : undefined,
    knownConstraints: [],
    conflicts: [],
    pendingValidation: reliabilityMode === 'manual_unverified' ? ['Revisión manual pendiente.'] : [],
    reliability: reliabilityMode
      ? { mode: reliabilityMode, sourceIssues: [] }
      : undefined,
  }
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

  it('rechaza un parámetro atribuido a la parcela cuando el régimen no está determinado', () => {
    const partial = { ...determined, status: 'PARCIAL' as const, canAnswerConcreteParameters: false }
    const validation = validateGeneratedAnswer(
      'La altura máxima es de 7 m [Fuente 1].',
      [source],
      partial,
      'regime'
    )

    expect(validation.valid).toBe(false)
    expect(validation.reasons.join(' ')).toMatch(/parámetro de parcela sin régimen determinado/i)
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

  it('rechaza un parámetro atribuido expresamente a esta parcela sin régimen determinado', () => {
    const partial = { ...determined, status: 'PARCIAL' as const, canAnswerConcreteParameters: false }
    const parameterSource = {
      ...source,
      content: 'La parcela mínima es de 200 m².',
    }

    const validation = validateGeneratedAnswer(
      'Para esta parcela, la parcela mínima es 200 m² [Fuente 1].',
      [parameterSource],
      partial,
      'mixed'
    )

    expect(validation.valid).toBe(false)
    expect(validation.reasons).toContain('La respuesta atribuye un parámetro de parcela sin régimen determinado.')
  })

  it('permite inventariar varias ordenanzas citadas cuando declara que no puede saber cuál aplica', () => {
    const partial = { ...determined, status: 'PARCIAL' as const, canAnswerConcreteParameters: false }
    const inventorySource = {
      ...source,
      content:
        'Ordenanza A: parcela mínima de 200 m² y ocupación máxima del 20%. Ordenanza B: parcela mínima de 500 m² y ocupación máxima del 10%.',
    }

    const validation = validateGeneratedAnswer(
      'Se han recuperado varias ordenanzas, pero no puede determinarse cuál corresponde a esta parcela. Una ordenanza establece una parcela mínima de 200 m² y ocupación máxima del 20% [Fuente 1]. Otra ordenanza establece una parcela mínima de 500 m² y ocupación máxima del 10% [Fuente 1].',
      [inventorySource],
      partial,
      'mixed'
    )

    expect(validation).toEqual({ valid: true, reasons: [], citations: [1] })
  })

  it('rechaza una cifra normativa material sin fuente aunque se presente como recuperación', () => {
    const partial = { ...determined, status: 'PARCIAL' as const, canAnswerConcreteParameters: false }

    const validation = validateGeneratedAnswer(
      'Se ha localizado que la ocupación máxima es del 20%.',
      [source],
      partial,
      'mixed'
    )

    expect(validation.valid).toBe(false)
    expect(validation.reasons).toContain('Existe una cifra normativa sin respaldo en las fuentes recuperadas.')
  })

  it('permite una afirmación metadocumental sin cita', () => {
    const partial = { ...determined, status: 'PARCIAL' as const, canAnswerConcreteParameters: false }

    const validation = validateGeneratedAnswer(
      'He localizado documentación con condiciones de parcela y ocupación.',
      [source],
      partial,
      'mixed'
    )

    expect(validation).toEqual({ valid: true, reasons: [], citations: [] })
  })

  it('permite informar sin cita que no se ha localizado la ordenanza específica aplicable', () => {
    const partial = { ...determined, status: 'PARCIAL' as const, canAnswerConcreteParameters: false }

    const validation = validateGeneratedAnswer(
      'No se ha localizado la ordenanza específica aplicable.',
      [source],
      partial,
      'mixed'
    )

    expect(validation).toEqual({ valid: true, reasons: [], citations: [] })
  })

  it('mantiene la cita unida a una referencia jerárquica de artículo', () => {
    const articleSource = {
      ...source,
      content: 'El artículo 8.1.5 establece una ocupación máxima del 20%.',
    }

    const validation = validateGeneratedAnswer(
      'El art. 8.1.5. establece una ocupación máxima del 20% [Fuente 1] [Fuente 2].',
      [articleSource, articleSource],
      determined
    )

    expect(validation).toEqual({ valid: true, reasons: [], citations: [1, 2] })
  })

  it('permite una descripción temática de documentación recuperada sin cita', () => {
    const partial = { ...determined, status: 'PARCIAL' as const, canAnswerConcreteParameters: false }

    const validation = validateGeneratedAnswer(
      'La documentación recuperada incluye fragmentos de la normativa que regulan condiciones de parcela, ocupación, usos y remisiones al POL.',
      [source],
      partial,
      'mixed'
    )

    expect(validation).toEqual({ valid: true, reasons: [], citations: [] })
  })

  it('rechaza una condición material sin cita aunque mencione documentación recuperada', () => {
    const partial = { ...determined, status: 'PARCIAL' as const, canAnswerConcreteParameters: false }

    const validation = validateGeneratedAnswer(
      'La documentación recuperada establece una ocupación máxima del 20%.',
      [source],
      partial,
      'mixed'
    )

    expect(validation.valid).toBe(false)
    expect(validation.reasons).toContain('Existe una cifra normativa sin respaldo en las fuentes recuperadas.')
  })

  it('permite describir la fiabilidad manual de la clasificación como dato de contexto', () => {
    const partial = { ...determined, status: 'PARCIAL' as const, canAnswerConcreteParameters: false }

    const validation = validateGeneratedAnswer(
      'La clasificación de la parcela como núcleo rural es un dato manual no verificado; el último intento de verificación fue el 2026-08-07 [contexto].',
      [source],
      partial,
      'mixed'
    )

    expect(validation).toEqual({ valid: true, reasons: [], citations: [] })
  })

  it('permite una superficie factual de contexto sin la etiqueta [contexto]', () => {
    const validation = validateGeneratedAnswer(
      'Superficie del área de actuación: 1764,22 m²; parcela catastral completa: 1790,46 m².',
      [source],
      determined,
      'independent'
    )

    expect(validation).toEqual({ valid: true, reasons: [], citations: [] })
  })

  it('permite una superficie factual de contexto con la etiqueta [contexto]', () => {
    const validation = validateGeneratedAnswer(
      'Superficie del área de actuación: 1764,22 m²; parcela catastral completa: 1790,46 m² [contexto].',
      [source],
      determined,
      'independent'
    )

    expect(validation).toEqual({ valid: true, reasons: [], citations: [] })
  })

  it('acepta el patrón de respuesta RAW de la última auditoría documental', () => {
    const partial = { ...determined, status: 'PARCIAL' as const, canAnswerConcreteParameters: false }
    const auditSource = {
      ...source,
      content:
        'El artículo 8.1.5 establece parcela mínima de 5.000 m² y de 200 m², ocupación máxima del 20%, frente mínimo de 6 metros, círculo de 4 metros, separación de 5 metros, pendiente del 25%, parcela mínima de 1.000 m², frente de 16 metros, círculo de 12 metros y ocupación máxima del 50%.',
    }
    const sources = Array.from({ length: 8 }, () => auditSource)

    const validation = validateGeneratedAnswer(
      `La documentación recuperada incluye fragmentos de la normativa urbanística del PXOM que regulan condiciones de parcela, ocupación, usos y remisiones al POL. No puedo determinar con certeza cuál de estas ordenanzas es la aplicable a la parcela concreta.
Superficie del área de actuación: 1764,22 m²; parcela catastral completa: 1790,46 m².
Un grupo de fragmentos establece una parcela mínima de 5.000 m² y una ocupación máxima del 20% sobre la parcela edificable, con remisión al artículo 8.1.5. para excepciones [Fuente 1], [Fuente 3], [Fuente 4].
Otro grupo de fragmentos corresponde a una ordenanza con parcela mínima de 200 m², frente mínimo de 6 metros y círculo inscribible de 4 metros [Fuente 2], [Fuente 5].
Un tercer grupo de fragmentos regula una ordenanza con parcela mínima de 5.000 m², ocupación máxima del 5%, separación a linderos de 5 metros y pendiente del 25% [Fuente 6].
Otros fragmentos corresponden a ordenanzas con parcela mínima de 1.000 m², frente mínimo de 16 metros, círculo inscribible de 12 metros y ocupación máxima del 50% [Fuente 7], [Fuente 8].
La clasificación de la parcela como núcleo rural es un dato manual no verificado; el último intento de verificación fue el 2026-08-07.`,
      sources,
      partial,
      'mixed'
    )

    expect(validation.valid).toBe(true)
  })
})

describe('categorical territorial confirmations', () => {
  const parcelQuestion = '¿Puedo considerar toda la parcela como Núcleo Rural Común (SNRC)?'
  const actionAreaQuestion = '¿Puedo considerar el área seleccionada como Núcleo Rural Común (SNRC)?'
  const categoricalAnswer = 'CONCLUSIÓN\nSí, toda la parcela puede considerarse Núcleo Rural Común (SNRC) [contexto].'

  it.each([
    ['manual_unverified', confirmationContext({ parcelStatus: 'manual_review_required', reliabilityMode: 'manual_unverified' })],
    ['unresolved', confirmationContext({ parcelStatus: 'not_available', reliabilityMode: 'unresolved' })],
    ['conflict', confirmationContext({ parcelStatus: 'conflict' })],
    ['automatic_probable', confirmationContext({ parcelStatus: 'automatic_probable' })],
  ])('rejects a categorical parcel confirmation for %s', (_label, provisionalContext) => {
    const validation = validateGeneratedAnswer(
      categoricalAnswer,
      [],
      determined,
      'regime',
      provisionalContext,
      false,
      parcelQuestion
    )

    expect(validation.valid).toBe(false)
    expect(validation.reasons).toContain(
      'La respuesta confirma categóricamente un régimen territorial no verificado o de otro ámbito.'
    )
  })

  it('does not use actionArea facts to confirm the whole parcel', () => {
    const validation = validateGeneratedAnswer(
      categoricalAnswer,
      [],
      determined,
      'regime',
      confirmationContext({ actionAreaStatus: 'automatic_confirmed' }),
      false,
      parcelQuestion
    )

    expect(validation.valid).toBe(false)
    expect(buildStructuredParcelFactAnswer('¿Qué categoría tiene toda la parcela?', confirmationContext({ actionAreaStatus: 'automatic_confirmed' }))?.answer)
      .toContain('Categoría: no determinada.')
  })

  it('does not use parcel facts to confirm an unbacked actionArea', () => {
    const validation = validateGeneratedAnswer(
      'Sí, el área seleccionada puede considerarse Núcleo Rural Común (SNRC) [contexto].',
      [],
      determined,
      'regime',
      confirmationContext({ parcelStatus: 'automatic_confirmed' }),
      false,
      actionAreaQuestion
    )

    expect(validation.valid).toBe(false)
    expect(buildStructuredParcelFactAnswer('¿Qué categoría tiene el área seleccionada?', confirmationContext({ parcelStatus: 'automatic_confirmed' }))?.answer)
      .toContain('Categoría: no determinada.')
  })

  it('preserves an affirmative answer for a confirmed fact from the requested scope', () => {
    const validation = validateGeneratedAnswer(
      categoricalAnswer,
      [],
      determined,
      'regime',
      confirmationContext({ parcelStatus: 'automatic_confirmed', reliabilityMode: 'current_official' }),
      false,
      parcelQuestion
    )

    expect(validation).toEqual({ valid: true, reasons: [], citations: [] })
  })

  it('does not turn an automatic probable structured fact into a categorical confirmation', () => {
    const answer = buildStructuredParcelFactAnswer(
      '¿Puedo confirmar la categoría de toda la parcela como Núcleo Rural Común (SNRC)?',
      confirmationContext({ parcelStatus: 'automatic_probable' })
    )?.answer

    expect(answer).toContain('Categoría: no determinada.')
    expect(answer).not.toContain('Categoría: Núcleo Rural Común (SNRC).')
  })

  it('instructs the model to qualify provisional states and preserve scope', () => {
    const prompt = buildMunicipalSafetyPrompt(
      confirmationContext({ parcelStatus: 'manual_review_required', reliabilityMode: 'manual_unverified' }),
      determined,
      [],
      'regime'
    )

    expect(prompt).toContain('Nunca extrapoles de actionArea a parcel ni de parcel a actionArea')
    expect(prompt).toContain('no comiences con "Sí"')
    expect(prompt).toContain('automatic_confirmed o technician_validated')
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
    expect(prompt).toContain('debe llevar literalmente [contexto]')
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

  it('accepts structured facts and non-numeric normative descriptions without a RAG citation', () => {
    const structural = validateGeneratedAnswer(
      'El expediente identifica suelo urbano sin consolidar [contexto]. No se ha recuperado evidencia documental suficiente para concretar sus consecuencias.',
      [source], partial, 'independent', contextWithFacts
    )
    const normative = validateGeneratedAnswer(
      'El expediente identifica suelo urbano sin consolidar [contexto]. La norma permite licencia directa.',
      [source], partial, 'independent', contextWithFacts
    )
    const disguisedNormative = validateGeneratedAnswer(
      'La parcela clasificada como suelo urbano sin consolidar [contexto] permite licencia directa.',
      [source], partial, 'independent', contextWithFacts
    )

    expect(structural.valid).toBe(true)
    expect(normative.valid).toBe(true)
    expect(disguisedNormative.valid).toBe(true)
  })

  it('includes confirmed affects only when the question is about them', () => {
    const withAffect = { ...contextWithFacts, knownConstraints: [{ value: 'Carreteras: zona de proteccion', source: 'ideg' as const, confidence: 0.95, verification: 'confirmed' as const }] }
    const answer = buildSafeAbstention(partial, withAffect, 'Â¿Que afecciones tiene la parcela?')

    expect(answer).toContain('AFECCIONES CONFIRMADAS')
    expect(answer).toContain('Carreteras: zona de proteccion')
  })
})
