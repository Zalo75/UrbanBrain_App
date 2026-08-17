import { describe, expect, it } from 'vitest'
import {
  validateReasonerOutput,
  renderFinalAnswer,
  buildSafeAbstention,
  parseReasonerOutput,
  buildDeterministicMissingFacts,
  buildMunicipalSafetyPrompt,
  buildReviewSafetyPrompt,
} from './responseSafety'
import type { ReasonerOutput, NormativeCandidate, ApplicabilityResult, NormalizedParcelContext } from '@/domain/parcel-context/types'

describe('V3-B Claim-level validation & rendering', () => {
  const sources: NormativeCandidate[] = [
    { id: 'source-1', content: 'Retranqueo mínimo 5 m y ocupación 30 %', title: 'article' }
  ]
  const app: ApplicabilityResult = {
    status: 'DETERMINADO',
    canAnswerConcreteParameters: true,
    mustAbstainBeforeLlm: false,
    municipalCandidateCount: 1,
    municipalDocumentCount: 1,
    municipalScopedRetrieval: false,
    municipalScopeDocumentNameCount: 1,
    municipalScopeHasOrdinance: false,
    municipalScopeDiagnosticCode: 'NO_DOCUMENT_FILTER',
    supplementaryV1CandidateCount: 0,
    supplementaryCandidateCountsByLayer: {},
    v2CandidateCount: 0,
    answerCandidateCount: 1,
    missingData: [],
    rejected: []
  }

  describe('JSON y schema coverage', () => {
    it('rejects JSON inválido', () => {
      expect(parseReasonerOutput('{not-json')).toBeNull()
    })

    it('rejects schema inválido', () => {
      expect(parseReasonerOutput(JSON.stringify({ answerMode: 'definitive', claims: [] }))).toBeNull()
    })

    it('handles content vacío', () => {
      expect(parseReasonerOutput('')).toBeNull()
      const out: ReasonerOutput = { answerMode: 'abstain', claims: [], missingFacts: [] }
      const res = validateReasonerOutput(out, sources, app)
      expect(res.invalidClaimCount).toBe(0)
    })

    it('rejects type inválido', () => {
      const out: unknown = { answerMode: 'definitive', claims: [{ id: '1', type: 'INVALID', text: 'x', sourceRefs: [1], appliesToParcel: 'unknown', numericTokens: [] }], missingFacts: [] }
      expect(parseReasonerOutput(JSON.stringify(out))).toBeNull()
    })

    it('rejects appliesToParcel inválido', () => {
      const out: unknown = { answerMode: 'definitive', claims: [{ id: '1', type: 'normative_fact', text: 'x', sourceRefs: [1], appliesToParcel: 'invalid', numericTokens: [] }], missingFacts: [] }
      expect(parseReasonerOutput(JSON.stringify(out))).toBeNull()
    })
  })

  describe('Extracción defensiva', () => {
    it('detects numeric tokens defensively even if numericTokens is empty', () => {
      const output: ReasonerOutput = {
        answerMode: 'definitive',
        missingFacts: [],
        claims: [{
          id: '1', type: 'normative_fact', text: 'El retranqueo es de 5 m',
          sourceRefs: [1], appliesToParcel: 'unknown', numericTokens: []
        }]
      }
      const res = validateReasonerOutput(output, sources, app)
      expect(res.invalidClaimCount).toBe(0)
    })

    it('rejects if defensive number is not in source', () => {
      const output: ReasonerOutput = {
        answerMode: 'definitive',
        missingFacts: [],
        claims: [{
          id: '1', type: 'normative_fact', text: 'El retranqueo es de 10 m',
          sourceRefs: [1], appliesToParcel: 'unknown', numericTokens: []
        }]
      }
      const res = validateReasonerOutput(output, sources, app)
      expect(res.invalidClaimCount).toBe(1)
      expect(res.invalidClaimReasonCounts['UNSUPPORTED_NUMBER']).toBe(1)
    })

    it('supports complex decimal notations', () => {
      const complexSources: NormativeCandidate[] = [{ id: 'source-1', content: 'Parcela mínima de 355,1 m² o 5.0 m de frente.', title: 'article' }]

      const tests = ['5,00 m', '5.0 m', '355,1 m²']

      for (const t of tests) {
        const out: ReasonerOutput = {
          answerMode: 'definitive', missingFacts: [],
          claims: [{ id: '1', type: 'normative_fact', text: t, sourceRefs: [1], appliesToParcel: 'unknown', numericTokens: [] }]
        }
        const res = validateReasonerOutput(out, complexSources, app)
        expect(res).toBeDefined()
      }
    })
  })

  describe('Claim-level filtering', () => {
    it('renders A valid, C valid, but hides B invalid', () => {
      const output: ReasonerOutput = {
        answerMode: 'definitive',
        missingFacts: [],
        claims: [
          { id: '1', type: 'normative_fact', text: 'Claim A', sourceRefs: [1], appliesToParcel: 'unknown', numericTokens: [] },
          { id: '2', type: 'normative_fact', text: 'Claim B 10m', sourceRefs: [1], appliesToParcel: 'unknown', numericTokens: [] },
          { id: '3', type: 'normative_fact', text: 'Claim C', sourceRefs: [1], appliesToParcel: 'unknown', numericTokens: [] },
        ]
      }
      const res = validateReasonerOutput(output, sources, app)
      expect(res.validClaims.map(c => c.id)).toEqual(['1', '3'])

      const finalHtml = renderFinalAnswer(output, res.validClaims)
      expect(finalHtml).toContain('Claim A')
      expect(finalHtml).toContain('Claim C')
      expect(finalHtml).not.toContain('Claim B')
      expect(finalHtml).not.toMatch(/rechazado|omitido|seguridad|inválido/i)
    })

    it('triggers buildSafeAbstention if all claims invalid', () => {
      const output: ReasonerOutput = {
        answerMode: 'definitive', missingFacts: [],
        claims: [
          { id: '2', type: 'normative_fact', text: 'Claim B 10m', sourceRefs: [1], appliesToParcel: 'unknown', numericTokens: [] },
        ]
      }
      const res = validateReasonerOutput(output, sources, app)
      expect(res.validClaims.length).toBe(0)

      const fallback = buildSafeAbstention(app, undefined, undefined, ['Dato faltante'])
      expect(fallback).toContain('Me abstengo')
    })

    it('rejects a parcel conclusion when concrete parameters are not authorized', () => {
      const output: ReasonerOutput = {
        answerMode: 'definitive',
        missingFacts: [],
        claims: [{ id: '1', type: 'parcel_conclusion', text: 'La parcela tiene una parcela mínima de 5 m', sourceRefs: [1], appliesToParcel: true, numericTokens: [] }],
      }
      const partial = { ...app, canAnswerConcreteParameters: false }
      const result = validateReasonerOutput(output, sources, partial)
      expect(result.validClaims).toHaveLength(0)
      expect(result.invalidClaimReasonCounts.UNAUTHORIZED_CONCLUSION).toBe(1)
    })

    it('accepts a parcel conclusion only when concrete parameters are authorized', () => {
      const output: ReasonerOutput = {
        answerMode: 'definitive',
        missingFacts: [],
        claims: [{ id: '1', type: 'parcel_conclusion', text: 'La parcela tiene una parcela mínima de 5 m', sourceRefs: [1], appliesToParcel: true, numericTokens: [] }],
      }
      const result = validateReasonerOutput(output, sources, app)
      expect(result.validClaims).toHaveLength(1)
    })
  })

  describe('Citation and provenance guarantees', () => {
    it('rejects a numeric claim without sourceRefs', () => {
      const output: ReasonerOutput = {
        answerMode: 'definitive',
        missingFacts: [],
        claims: [{ id: '1', type: 'normative_fact', text: 'La ocupación máxima es del 30 %', sourceRefs: [], appliesToParcel: 'unknown', numericTokens: [] }],
      }
      const result = validateReasonerOutput(output, sources, app)
      expect(result.validClaims).toHaveLength(0)
      expect(result.invalidClaimReasonCounts.UNSUPPORTED_NUMBER).toBe(1)
    })

    it('allows a non-numeric documentary claim without a citation', () => {
      const output: ReasonerOutput = {
        answerMode: 'partial',
        missingFacts: [],
        claims: [{ id: '1', type: 'limitation', text: 'No se ha localizado la ordenanza específica aplicable', sourceRefs: [], appliesToParcel: 'conditional', numericTokens: [] }],
      }
      const result = validateReasonerOutput(output, sources, app)
      expect(result.validClaims).toHaveLength(1)
      expect(renderFinalAnswer(output, result.validClaims)).toContain('No se ha localizado')
    })

    it('preserves every validated citation when rendering a claim', () => {
      const twoSources: NormativeCandidate[] = [
        { id: 'source-1', content: 'La ocupación máxima es del 30 %', title: 'A' },
        { id: 'source-2', content: 'La ocupación máxima es del 30 %', title: 'B' },
      ]
      const output: ReasonerOutput = {
        answerMode: 'definitive',
        missingFacts: [],
        claims: [{ id: '1', type: 'normative_fact', text: 'La ocupación máxima es del 30 %', sourceRefs: [1, 2], appliesToParcel: 'unknown', numericTokens: [] }],
      }
      const result = validateReasonerOutput(output, twoSources, app)
      expect(renderFinalAnswer(output, result.validClaims)).toContain('[Fuente 1] [Fuente 2]')
    })

    it('deduplicates repeated source references in the visible answer', () => {
      const output: ReasonerOutput = {
        answerMode: 'definitive',
        missingFacts: [],
        claims: [{ id: '1', type: 'normative_fact', text: 'La regla está documentada', sourceRefs: [1, 1], appliesToParcel: 'unknown', numericTokens: [] }],
      }
      const result = validateReasonerOutput(output, sources, app)
      const answer = renderFinalAnswer(output, result.validClaims)
      expect(answer.match(/\[Fuente 1\]/g)).toHaveLength(1)
    })

    it('does not let a territorial claim resolve an applicability conflict', () => {
      const output: ReasonerOutput = {
        answerMode: 'definitive',
        missingFacts: [],
        claims: [{ id: '1', type: 'territorial_fact', text: 'La clasificación es suelo urbano', sourceRefs: [], appliesToParcel: true, numericTokens: [] }],
      }
      const conflicted = { ...app, status: 'CONFLICTIVO' as const }
      const result = validateReasonerOutput(output, sources, conflicted)
      expect(result.validClaims).toHaveLength(0)
      expect(result.invalidClaimReasonCounts.CONFLICT_UNRESOLVED).toBe(1)
    })
  })

  describe('Conclusión determinista', () => {
    it('does not use any conclusion field from LLM', () => {
      const output: ReasonerOutput & { conclusion: string } = {
        answerMode: 'definitive' as const,
        missingFacts: ['Fact X'],
        conclusion: 'PELIGROSO TEXTO DEL LLM',
        claims: [
          { id: '1', type: 'normative_fact', text: 'Claim Seguro', sourceRefs: [1], appliesToParcel: 'unknown', numericTokens: [] as string[] }
        ]
      }
      const res = validateReasonerOutput(output, sources, app)
      const text = renderFinalAnswer(output, res.validClaims, ['Fact X'])

      expect(text).toContain('Claim Seguro')
      expect(text).toContain('Fact X')
      expect(text).not.toContain('PELIGROSO TEXTO DEL LLM')
    })
  })

  describe('Source validation', () => {
    it('rejects sourceRef = 0', () => {
      const out: ReasonerOutput = { answerMode: 'definitive', missingFacts: [], claims: [{ id: '1', type: 'normative_fact', text: 'x', sourceRefs: [0], appliesToParcel: 'unknown', numericTokens: [] }] }
      expect(validateReasonerOutput(out, sources, app).invalidClaimCount).toBe(1)
    })
    it('rejects sourceRef > sources.length', () => {
      const out: ReasonerOutput = { answerMode: 'definitive', missingFacts: [], claims: [{ id: '1', type: 'normative_fact', text: 'x', sourceRefs: [99], appliesToParcel: 'unknown', numericTokens: [] }] }
      expect(validateReasonerOutput(out, sources, app).invalidClaimCount).toBe(1)
    })
    it('rejects sourceRef no enteros', () => {
      const out: unknown = { answerMode: 'definitive', missingFacts: [], claims: [{ id: '1', type: 'normative_fact', text: 'x', sourceRefs: [1.5], appliesToParcel: 'unknown', numericTokens: [] }] }
      expect(validateReasonerOutput(out, sources, app).invalidClaimCount).toBe(1)
    })
  })

  describe('V3-D review evidence and deterministic missing facts', () => {
    const reviewSource: NormativeCandidate = {
      id: 'review-1',
      content: 'La separación será de 3 m para zona residencial aislada.',
      hierarchy: 'municipal',
    }
    const applicableSource: NormativeCandidate = {
      id: 'applicable-1',
      content: 'El retranqueo aplicable es de 5 m.',
      hierarchy: 'municipal',
    }

    it('rejects a parcel parameter supported only by review evidence but keeps a safe limitation', () => {
      const reviewApplicability: ApplicabilityResult = {
        ...app,
        status: 'PARCIAL',
        applicable: [],
        review: [reviewSource],
        canAnswerConcreteParameters: false,
      }
      const output: ReasonerOutput = {
        answerMode: 'partial',
        missingFacts: [],
        claims: [
          { id: 'bad', type: 'parcel_conclusion', text: 'El retranqueo aplicable a esta parcela es 3 m', sourceRefs: [1], appliesToParcel: true, numericTokens: [] },
          { id: 'safe', type: 'limitation', text: 'La normativa recuperada contiene alternativas, pero no permite vincular una cifra única a la parcela', sourceRefs: [], appliesToParcel: 'conditional', numericTokens: [] },
        ],
      }
      const result = validateReasonerOutput(output, [reviewSource], reviewApplicability)
      expect(result.invalidClaimReasonCounts.REVIEW_ONLY_PARCEL_CLAIM).toBe(1)
      expect(result.validClaims.map((claim) => claim.id)).toEqual(['safe'])
      expect(renderFinalAnswer(output, result.validClaims)).toContain('no permite vincular')
    })

    it('allows a descriptive review claim that does not attribute the rule to the parcel', () => {
      const reviewApplicability = { ...app, status: 'PARCIAL' as const, applicable: [], review: [reviewSource], canAnswerConcreteParameters: false }
      const output: ReasonerOutput = {
        answerMode: 'definitive',
        missingFacts: [],
        claims: [{ id: 'descriptive', type: 'normative_fact', text: 'El artículo establece 3 m para la zona residencial aislada', sourceRefs: [1], appliesToParcel: 'unknown', numericTokens: [] }],
      }
      const result = validateReasonerOutput(output, [reviewSource], reviewApplicability)
      expect(result.validClaims).toHaveLength(1)
    })

    it('allows an applicable parcel parameter and mixed applicable plus review evidence', () => {
      const mixedApplicability: ApplicabilityResult = {
        ...app,
        applicable: [applicableSource],
        review: [reviewSource],
        canAnswerConcreteParameters: true,
      }
      const applicableOutput: ReasonerOutput = {
        answerMode: 'definitive',
        missingFacts: [],
        claims: [{ id: 'applicable', type: 'parcel_conclusion', text: 'El retranqueo aplicable a esta parcela es 5 m', sourceRefs: [1], appliesToParcel: true, numericTokens: [] }],
      }
      expect(validateReasonerOutput(applicableOutput, [applicableSource], { ...mixedApplicability, review: [] }).validClaims).toHaveLength(1)

      const mixedOutput = { ...applicableOutput, claims: [{ ...applicableOutput.claims[0], sourceRefs: [1, 2] }] }
      expect(validateReasonerOutput(mixedOutput, [applicableSource, reviewSource], mixedApplicability).validClaims).toHaveLength(1)
    })

    it('suppresses model-proposed classification/category gaps when structured facts confirm them', () => {
      const confirmedContext = {
        qualification: { value: 'SNRSC', source: 'siotuga', confidence: 1, verification: 'confirmed' },
        urbanisticFacts: {
          classification: { status: 'automatic_confirmed', value: { code: 'SNR', label: 'SNR' }, origin: 'siotuga', evidence: [], confidence: 'high', discrepancies: [] },
          category: { status: 'automatic_confirmed', value: { code: 'SNRSC', label: 'SNRSC' }, origin: 'siotuga', evidence: [], confidence: 'high', discrepancies: [] },
        },
        knownConstraints: [],
        conflicts: [],
        pendingValidation: [],
      } as NormalizedParcelContext
      const missing = buildDeterministicMissingFacts(
        { ...app, missingData: ['clasificación del suelo', 'categoría, ordenanza, ámbito o ficha aplicable'] },
        confirmedContext
      )
      expect(missing).toEqual([])
    })

    it('keeps the genuinely missing Ames category while suppressing confirmed classification', () => {
      const amesContext = {
        landClass: { value: 'rustico', source: 'expediente', confidence: 1, verification: 'confirmed' },
        urbanisticFacts: {
          classification: { status: 'technician_validated', value: { code: 'SR', label: 'Suelo rústico' }, origin: 'technician_selection', evidence: [], confidence: 'high', discrepancies: [] },
          category: { status: 'not_available', value: undefined, origin: 'technician_selection', evidence: [], confidence: 'unknown', discrepancies: [] },
        },
        knownConstraints: [],
        conflicts: [],
        pendingValidation: [],
      } as NormalizedParcelContext
      const missing = buildDeterministicMissingFacts(
        { ...app, missingData: ['clasificación del suelo', 'categoría, ordenanza, ámbito o ficha aplicable'] },
        amesContext
      )
      expect(missing).toEqual(['categoría, ordenanza, ámbito o ficha aplicable'])
    })

    it('labels review evidence explicitly in both safety prompts', () => {
      const context = { knownConstraints: [], conflicts: [], pendingValidation: [] } as NormalizedParcelContext
      const reviewApplicability = { ...app, status: 'PARCIAL' as const, applicable: [], review: [reviewSource], canAnswerConcreteParameters: false }
      expect(buildMunicipalSafetyPrompt(context, reviewApplicability, [reviewSource], 'regime')).toContain('Aplicabilidad: REVISIÓN')
      expect(buildReviewSafetyPrompt(context, [reviewSource], 'regime')).toContain('Aplicabilidad: REVISIÓN')
    })
  })
})
