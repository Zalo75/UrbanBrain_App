import { describe, expect, it } from 'vitest'
import type { ApplicabilityResult, NormativeCandidate, ReasonerOutput } from '@/domain/parcel-context/types'
import {
  classifyQuestionIntent,
  composeSemanticAnswer,
  evaluateClaimRelevance,
  humanizeMissingFacts,
} from './semanticAnswerComposition'

const baseApplicability: ApplicabilityResult = {
  status: 'DETERMINADO',
  applicable: [],
  review: [],
  rejected: [],
  warnings: [],
  missingData: [],
  conflicts: [],
  canAnswerConcreteParameters: true,
  canAnswerGeneralRegime: true,
  canAnswerConditionalViability: false,
}

const output: ReasonerOutput = { answerMode: 'partial', claims: [], missingFacts: [] }

function claim(overrides: Partial<ReasonerOutput['claims'][number]>) {
  return {
    id: 'claim',
    type: 'normative_fact' as const,
    text: 'Regla normativa localizada',
    sourceRefs: [1],
    appliesToParcel: 'unknown' as const,
    numericTokens: [],
    ...overrides,
  }
}

describe('V3-E relevance and semantic composition', () => {
  it('classifies the closed question intents', () => {
    expect(classifyQuestionIntent('¿Cuánto retranqueo hay que dejar?', 'regime', true, false)).toBe('parcel_parameter')
    expect(classifyQuestionIntent('¿Se puede construir en esta parcela?', 'independent', false, true)).toBe('parcel_viability')
    expect(classifyQuestionIntent('¿Qué clasificación tiene?', 'regime', true, false)).toBe('parcel_regime')
    expect(classifyQuestionIntent('¿Qué dice el artículo 67?', 'independent', false, false)).toBe('normative_information')
    expect(classifyQuestionIntent('¿Se puede construir y qué retranqueo corresponde?', 'mixed', true, true)).toBe('mixed')
  })

  it('keeps review-only parameter evidence as context and adds a deterministic limitation', () => {
    const reviewSources: NormativeCandidate[] = [
      { id: 'review-1', content: 'El artículo establece un retranqueo de 3 m para residencial aislada.' },
      { id: 'review-2', content: 'El artículo establece un retranqueo de 5 m para equipamientos.' },
    ]
    const applicability = { ...baseApplicability, status: 'PARCIAL' as const, applicable: [], review: reviewSources, canAnswerConcreteParameters: false }
    const claims = [
      claim({ id: 'review-3m', text: 'El artículo establece un retranqueo de 3 m para residencial aislada.' }),
      claim({ id: 'review-5m', text: 'El artículo establece un retranqueo de 5 m para equipamientos.', sourceRefs: [2] }),
    ]
    const result = composeSemanticAnswer(output, claims, '¿Cuánto retranqueo hay que dejar en esta parcela?', 'parcel_parameter', reviewSources, applicability, [])
    expect(result.semanticFallbackReason).toBe('NO_APPLICABLE_PARAMETER_EVIDENCE')
    expect(result.answer).toContain('CONCLUSIÓN')
    expect(result.answer).toContain('No puede fijarse todavía el retranqueo aplicable a esta parcela con seguridad')
    expect(result.answer).toContain('FUNDAMENTO')
    expect(result.answer.split('FUNDAMENTO')[0]).not.toContain('3 m')
    expect(result.answer).toContain('Normativa localizada cuya aplicación concreta')
  })

  it('makes an applicable parameter claim primary and unrelated parameters irrelevant', () => {
    const source: NormativeCandidate = { id: 'applicable-1', content: 'Retranqueo mínimo 5 m.' }
    const applicability = { ...baseApplicability, applicable: [source] }
    const parameterClaim = claim({ id: 'setback', type: 'parcel_conclusion', text: 'El retranqueo aplicable es de 5 m.', appliesToParcel: true })
    const occupationClaim = claim({ id: 'occupation', text: 'La ocupación máxima es del 20 %.' })
    const answer = composeSemanticAnswer(output, [parameterClaim, occupationClaim], '¿Cuánto retranqueo hay que dejar?', 'parcel_parameter', [source], applicability, [])
    expect(answer.primaryClaimCount).toBe(1)
    expect(answer.answer).toContain('5 m')
    expect(answer.answer).not.toContain('20 %')
    expect(answer.answer).not.toContain('FUNDAMENTO')
    expect(answer.answer).not.toContain('PENDIENTE DE COMPROBAR')
    expect(answer.answer.indexOf('5 m')).toBeGreaterThan(answer.answer.indexOf('CONCLUSIÓN'))
    expect(evaluateClaimRelevance(occupationClaim, 'parcel_parameter', '¿Cuánto retranqueo hay que dejar?', [source], applicability).code).toBe('IRRELEVANT')
  })

  it('does not turn a supported sanction into a viability conclusion', () => {
    const source: NormativeCandidate = { id: 'applicable-1', content: 'La multa es del 15 % al 30 % del valor de la obra.' }
    const applicability = { ...baseApplicability, applicable: [source], canAnswerConditionalViability: true }
    const sanction = claim({ id: 'sanction', text: 'La normativa sanciona la edificación con multa del 15 % al 30 % del valor de la obra.' })
    const result = composeSemanticAnswer(output, [sanction], '¿Se puede construir en esta parcela?', 'parcel_viability', [source], applicability, ['categoría o calificación aplicable'])
    expect(result.semanticFallbackReason).toBe('CONDITIONAL_VIABILITY_ONLY')
    expect(result.answer).toContain('viabilidad urbanística de esta parcela no puede confirmarse')
    expect(result.answer).not.toContain('multa')
    expect(result.irrelevantClaimCount).toBe(1)
  })

  it('composes the viability fallback even when every model claim is filtered', () => {
    const source: NormativeCandidate = { id: 'applicable-1', content: 'La categoría aplicable determina la viabilidad.' }
    const applicability = { ...baseApplicability, applicable: [source], canAnswerConditionalViability: true }
    const result = composeSemanticAnswer(output, [], '¿Se puede construir en esta parcela?', 'parcel_viability', [source], applicability, ['categoría o calificación aplicable'])
    expect(result.semanticFallbackReason).toBe('CONDITIONAL_VIABILITY_ONLY')
    expect(result.answer).toContain('viabilidad urbanística de esta parcela no puede confirmarse')
    expect(result.answer).toContain('La categoría de suelo aplicable.')
    expect(result.answer).toContain('La calificación urbanística concreta de la parcela.')
    expect(result.answer.split('PENDIENTE DE COMPROBAR')[0]).not.toContain('categoría')
  })

  it('humanizes every deterministic missing-fact family without changing the input facts', () => {
    expect(humanizeMissingFacts([
      'clasificación del suelo',
      'categoría, calificación, ordenanza, ámbito o ficha aplicable',
      'evidencia documental suficiente para respaldar la respuesta',
    ])).toEqual([
      'La clasificación urbanística de la parcela.',
      'La categoría de suelo aplicable.',
      'La calificación urbanística concreta de la parcela.',
      'La ordenanza urbanística aplicable.',
      'El ámbito o zona de ordenación correspondiente.',
      'La ficha urbanística correspondiente, si existe.',
      'Evidencia documental suficiente para confirmar la regla aplicable.',
    ])
  })

  it('keeps conditional viability safe and uses only deterministic missing facts', () => {
    const source: NormativeCandidate = { id: 'applicable-1', content: 'La edificabilidad depende de la categoría aplicable.' }
    const applicability = { ...baseApplicability, applicable: [source], canAnswerConditionalViability: true }
    const conditional = claim({ id: 'conditional', type: 'normative_conditional', text: 'La viabilidad depende de la categoría aplicable.' })
    const result = composeSemanticAnswer(output, [conditional], '¿Se puede construir en esta parcela?', 'parcel_viability', [source], applicability, ['categoría, ordenanza o ámbito aplicable'])
    expect(result.primaryClaimCount).toBe(1)
    expect(result.semanticFallbackUsed).toBe(false)
    expect(result.answer).toContain('depende de la categoría')
  })

  it('preserves both requested components in a mixed query', () => {
    const setbackSource: NormativeCandidate = { id: 'setback', content: 'Retranqueo aplicable 5 m.' }
    const viabilitySource: NormativeCandidate = { id: 'viability', content: 'La viabilidad depende de la categoría aplicable.' }
    const applicability = { ...baseApplicability, applicable: [setbackSource, viabilitySource], canAnswerConditionalViability: true }
    const result = composeSemanticAnswer(
      output,
      [
        claim({ id: 'setback-claim', type: 'parcel_conclusion', text: 'El retranqueo aplicable es de 5 m.', appliesToParcel: true, sourceRefs: [1] }),
        claim({ id: 'viability-claim', type: 'normative_conditional', text: 'La viabilidad depende de la categoría aplicable.', sourceRefs: [2] }),
      ],
      '¿Se puede construir y qué retranqueo corresponde?',
      'mixed',
      [setbackSource, viabilitySource],
      applicability,
      []
    )
    expect(result.primaryClaimCount).toBe(2)
    expect(result.answer).toContain('retranqueo aplicable')
    expect(result.answer).toContain('viabilidad depende')
  })

  it('allows review evidence for direct normative-information questions', () => {
    const source: NormativeCandidate = { id: 'review-1', content: 'El artículo 67 establece un retranqueo de 3 m.' }
    const applicability = { ...baseApplicability, status: 'PARCIAL' as const, applicable: [], review: [source], canAnswerConcreteParameters: false }
    const result = composeSemanticAnswer(
      output,
      [claim({ id: 'article-67', text: 'El artículo 67 establece un retranqueo de 3 m.' })],
      '¿Qué dice el artículo 67?',
      'normative_information',
      [source],
      applicability,
      []
    )
    expect(result.primaryClaimCount).toBe(1)
    expect(result.answer).toContain('3 m')
  })

  it('renders one structured citation even when the claim contains inline duplicates', () => {
    const source: NormativeCandidate = { id: 'source-1', content: 'Retranqueo mínimo 5 m.' }
    const source3: NormativeCandidate = { id: 'source-3', content: 'Retranqueo mínimo 5 m.' }
    const applicability = { ...baseApplicability, applicable: [source, source3] }
    const result = composeSemanticAnswer(
      output,
      [claim({ id: 'cited', type: 'parcel_conclusion', text: 'El retranqueo es de 5 m [Fuente 1].', appliesToParcel: true, sourceRefs: [1, 1, 2] })],
      '¿Cuánto retranqueo hay que dejar?',
      'parcel_parameter',
      [source, source3],
      applicability,
      []
    )
    expect(result.answer.match(/\[Fuente 1\]/g)).toHaveLength(1)
    expect(result.answer.match(/\[Fuente 2\]/g)).toHaveLength(1)
  })
})
