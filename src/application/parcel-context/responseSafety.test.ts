import { describe, expect, it } from 'vitest'
import {
  validateReasonerOutput,
  canonicalizeNumericToken,
  renderFinalAnswer,
  buildSafeAbstention,
  parseReasonerOutput,
  buildDeterministicMissingFacts,
  buildMunicipalSafetyPrompt,
  buildReviewSafetyPrompt,
  renderValidatedClaimsNeutral,
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

    it('ignores citation metadata echoed in numericTokens', () => {
      const output: ReasonerOutput = {
        answerMode: 'conditional',
        missingFacts: [],
        claims: [{
          id: '1',
          type: 'normative_fact',
          text: 'La Ordenanza R-2 se regula en el artículo 130, página 145 del documento 27387no306.pdf.',
          sourceRefs: [1],
          appliesToParcel: 'conditional',
          numericTokens: ['27387', '130', '145', '152'],
        }],
      }
      const result = validateReasonerOutput(output, [{
        id: 'source-1',
        content: 'La Ordenanza R-2 se regula en el artículo 130.',
        title: 'article',
      }], app)
      expect(result.validClaims).toHaveLength(1)
      expect(result.invalidClaimReasonCounts.UNSUPPORTED_NUMBER).toBeUndefined()
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

    it('accepts grouped thousands written with spaces', () => {
      const source: NormativeCandidate[] = [{ id: 'source-1', content: 'Superficie mínima: 1.000,50 m²', title: 'article' }]
      const output: ReasonerOutput = {
        answerMode: 'definitive', missingFacts: [],
        claims: [{ id: '1', type: 'normative_fact', text: 'La superficie mínima es 1 000,50 m²', sourceRefs: [1], appliesToParcel: 'unknown', numericTokens: [] }]
      }
      const result = validateReasonerOutput(output, source, app)
      expect(result.validClaims).toHaveLength(1)
    })

    it('does not equate compatible numbers with incompatible units', () => {
      const output: ReasonerOutput = {
        answerMode: 'definitive', missingFacts: [],
        claims: [{ id: '1', type: 'normative_fact', text: 'La superficie es de 5 m', sourceRefs: [1], appliesToParcel: 'unknown', numericTokens: [] }]
      }
      const result = validateReasonerOutput(output, [{ id: 'source-1', content: 'La superficie es de 5 m²' }], app)
      expect(result.invalidClaimReasonCounts.UNSUPPORTED_NUMBER).toBe(1)
    })

    it('normalizes Spanish and Galician number words with units', () => {
      const source: NormativeCandidate[] = [{ id: 'source-1', content: 'A altura máxima será de dúas plantas e 7 metros; noutras zonas, unha planta e 3,50 metros.' }]
      const output: ReasonerOutput = {
        answerMode: 'conditional', missingFacts: [],
        claims: [{ id: '1', type: 'normative_fact', text: 'La altura máxima es de dos plantas y 7 m; en otras zonas, una planta y 3,50 m', sourceRefs: [1], appliesToParcel: 'conditional', numericTokens: ['dos plantas', '7 m', 'una planta', '3,50 m'] }]
      }
      const result = validateReasonerOutput(output, source, app)
      expect(result.validClaims).toHaveLength(1)
    })

    it('rejects a different decimal or percentage even when another source contains it', () => {
      const source: NormativeCandidate[] = [
        { id: 'source-1', content: 'La ocupación es 30 % y la superficie 98,53 m²' },
        { id: 'source-2', content: 'La ocupación es 40 % y la superficie 98,54 m²' },
      ]
      const output: ReasonerOutput = {
        answerMode: 'definitive', missingFacts: [],
        claims: [{ id: '1', type: 'normative_fact', text: 'La ocupación es 31 %', sourceRefs: [1], appliesToParcel: 'unknown', numericTokens: [] }]
      }
      const result = validateReasonerOutput(output, source, app)
      expect(result.invalidClaimReasonCounts.UNSUPPORTED_NUMBER).toBe(1)

      const wrongDecimal = { ...output, claims: [{ ...output.claims[0], text: 'La superficie es 98,54 m²', sourceRefs: [1] }] }
      const decimalResult = validateReasonerOutput(wrongDecimal, source, app)
      expect(decimalResult.invalidClaimReasonCounts.UNSUPPORTED_NUMBER).toBe(1)
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
      expect(fallback).toContain('No puede determinarse con seguridad el régimen urbanístico')
    })

    it('does not ask again for known parcel facts in a documentary fallback', () => {
      const context = {
        cadastralReference: { value: '36059A03900148', verification: 'confirmed' },
        municipality: { value: { name: 'Vila de Cruces', ineCode: '36059' }, verification: 'confirmed' },
        landClass: { value: 'urbano_no_consolidado', verification: 'confirmed' },
        planningInstrument: { value: 'NORMAS SUBSIDIARIAS DE PLANEAMENTO', verification: 'confirmed' },
        urbanisticFacts: {
          classification: { status: 'automatic_confirmed', value: { code: 'SU', label: 'Suelo urbano' }, discrepancies: [] },
          category: { status: 'automatic_confirmed', value: { code: 'SUSC', label: 'Suelo urbano sin consolidar' }, discrepancies: [] },
        },
        knownConstraints: [],
        conflicts: [],
        pendingValidation: [],
      } as unknown as NormalizedParcelContext
      const fallback = buildSafeAbstention(
        { ...app, missingData: ['referencia catastral, dirección o coordenadas', 'clasificación del suelo', 'categoría, ordenanza, ámbito o ficha aplicable'], applicable: [], rejected: [{ candidate: sources[0], reason: 'evidencia documental insuficiente' }] },
        context,
        '¿Qué establece la normativa para el suelo urbano sin consolidar?'
      )
      expect(fallback).not.toContain('Necesito referencia catastral')
      expect(fallback).not.toContain('Faltan estos datos:')
      expect(fallback).toContain('La normativa localizada no permite confirmar todavía')
      expect(fallback).not.toContain('no pueden vincularse de forma segura con esta parcela')
    })

    it('conserva una ordenanza confirmada cuando faltan sus parámetros normativos', () => {
      const confirmedContext = {
        municipality: { value: { name: 'Teo', ineCode: '15082' }, verification: 'confirmed' },
        planningInstrument: { value: 'PXOM de Teo', verification: 'confirmed' },
        qualification: { value: 'R-2', source: 'manual', verification: 'confirmed' },
        ordinanceCandidates: [{
          identity: 'R-2',
          instrumentId: 'instrument-current',
          status: 'user_confirmed',
          provenance: ['Extraído de la leyenda oficial WMS'],
        }],
        knownConstraints: [],
        conflicts: [],
        pendingValidation: [],
      } as unknown as NormalizedParcelContext
      const applicability = {
        ...app,
        canAnswerConcreteParameters: false,
        missingData: [
          'MISSING_REGIME_VALIDATION',
          'evidencia documental suficiente para respaldar las afirmaciones normativas solicitadas',
        ],
        applicable: [],
        rejected: [],
      }

      expect(buildDeterministicMissingFacts(applicability, confirmedContext)).toEqual([
        'evidencia documental suficiente para respaldar las afirmaciones normativas solicitadas',
      ])
      const fallback = buildSafeAbstention(
        applicability,
        confirmedContext,
        '¿Cuál es la ordenanza aplicable a esta parcela y qué condiciones urbanísticas establece para ella?'
      )
      expect(fallback).toContain('Ordenanza aplicable: R-2 (confirmada por el usuario).')
      expect(fallback).toContain('No dispongo de evidencia normativa suficiente para afirmar sus parámetros.')
      expect(fallback).not.toContain('Faltan estos datos: ordenanza o zona normativa aplicable')
    })

    it('keeps a general normative fact when the model tags it as parcel-related', () => {
      const output: ReasonerOutput = {
        answerMode: 'partial',
        missingFacts: ['ordenanza pormenorizada'],
        claims: [{
          id: 'general-su-sc',
          type: 'normative_fact',
          text: 'Las NNSS de Vila de Cruces establecen el régimen general del suelo urbano sin consolidar.',
          sourceRefs: [1],
          appliesToParcel: true,
          numericTokens: [],
        }],
      }
      const context = {
        municipality: { value: { name: 'Vila de Cruces', ineCode: '36059' }, verification: 'confirmed' },
        planningInstrument: { value: 'NORMAS SUBSIDIARIAS DE PLANEAMENTO', verification: 'confirmed' },
        landClass: { value: 'urbano_no_consolidado', verification: 'confirmed' },
      } as unknown as NormalizedParcelContext
      const applicability = {
        ...app,
        canAnswerConcreteParameters: false,
        applicable: [sources[0]],
        rejected: [],
      }
      const result = validateReasonerOutput(
        output,
        [{ ...sources[0], content: 'Las NNSS establecen el régimen general del suelo urbano sin consolidar.' }],
        applicability,
        context,
        'independent'
      )
      expect(result.validClaims).toHaveLength(1)
      expect(result.invalidClaimReasonCounts.UNAUTHORIZED_CONCLUSION).toBeUndefined()
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

  
  describe('Numeric validation robustness (Part A)', () => {
    it('canonicalizes thousands separators, decimals, and units correctly', () => {
      
      
      expect(canonicalizeNumericToken('1.000 m2')).toBe('1000m2');
      expect(canonicalizeNumericToken('1000 m²')).toBe('1000m2');
      expect(canonicalizeNumericToken('5,00 metros')).toBe('5m');
      expect(canonicalizeNumericToken('5 m')).toBe('5m');
      expect(canonicalizeNumericToken('5,0 m')).toBe('5m');
      expect(canonicalizeNumericToken('50 %')).toBe('50%');
      expect(canonicalizeNumericToken('50%')).toBe('50%');
      expect(canonicalizeNumericToken('98,53 %')).toBe('98.53%');
      expect(canonicalizeNumericToken('98.53%')).toBe('98.53%');
      expect(canonicalizeNumericToken('1,47 %')).toBe('1.47%');
      expect(canonicalizeNumericToken('1.47%')).toBe('1.47%');

      expect(canonicalizeNumericToken('5 m')).not.toBe(canonicalizeNumericToken('5 %'));
      expect(canonicalizeNumericToken('5 m')).not.toBe(canonicalizeNumericToken('5 m²'));
      expect(canonicalizeNumericToken('5000')).not.toBe(canonicalizeNumericToken('500'));
    });

    it('matches normalized numbers against context values', () => {
      
      const ctx = {
        parcelSurfaceSquareMetres: 1790.46,
        urbanisticFacts: {
          classification: { candidates: [{ parcelPercentage: 98.53 }] },
          category: { candidates: [] }
        }
      };
      const out = {
        answerMode: 'definitive', missingFacts: [],
        claims: [{ id: '1', type: 'normative_fact', text: 'El área es de 1790,46 m2', sourceRefs: [], appliesToParcel: 'unknown', numericTokens: [] }]
      };
      const res = validateReasonerOutput(out, [], { canAnswerConcreteParameters: true }, ctx);
      expect(res.invalidClaimCount).toBe(0);
    });

    it('accepts an exact cadastral reference already present in context', () => {
      const ctx = { cadastralReference: { value: '15009A01300255' } } as NormalizedParcelContext
      const out: ReasonerOutput = {
        answerMode: 'definitive', missingFacts: [],
        claims: [{ id: '1', type: 'territorial_fact', text: 'La referencia es 15009A01300255', sourceRefs: [], appliesToParcel: true, numericTokens: ['15009A01300255'] }]
      }
      const res = validateReasonerOutput(out, [], { canAnswerConcreteParameters: true }, ctx)
      expect(res.validClaims).toHaveLength(1)
    })

    it('rejects unsupported numbers normally', () => {
      
      const out = {
        answerMode: 'definitive', missingFacts: [],
        claims: [{ id: '1', type: 'normative_fact', text: 'El área es de 100 m2', sourceRefs: [1], appliesToParcel: 'unknown', numericTokens: [] }]
      };
      const res = validateReasonerOutput(out, [{ id: 's1', content: 'El área es de 200 m2' }], { canAnswerConcreteParameters: true });
      expect(res.invalidClaimReasonCounts.UNSUPPORTED_NUMBER).toBe(1);
    });

  });

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

    it('removes internal context markers from the final answer', () => {
      const output: ReasonerOutput = {
        answerMode: 'definitive', missingFacts: [],
        claims: [{ id: '1', type: 'normative_fact', text: 'La parcela está en SNR [contexto] y consta en el expediente [context].', sourceRefs: [1], appliesToParcel: 'unknown', numericTokens: [] }],
      }
      const result = validateReasonerOutput(output, sources, app)
      const rendered = renderFinalAnswer(output, result.validClaims)
      expect(rendered).not.toContain('[context]')
      expect(rendered).not.toContain('[contexto]')
      expect(rendered).toContain('La parcela está en SNR')
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
    it('preserves validated V2 claim wording without semantic templates', () => {
      const claims = [
        { id: 'r2', type: 'normative_fact' as const, text: 'La ordenanza aplicable es R-2.', sourceRefs: [1], appliesToParcel: 'conditional' as const, numericTokens: [] },
        { id: 'art130', type: 'normative_fact' as const, text: 'El Artículo 130 establece una superficie mínima de 5.000 m².', sourceRefs: [1], appliesToParcel: 'conditional' as const, numericTokens: ['5000'] },
        { id: 'limit', type: 'limitation' as const, text: 'La distribución espacial dentro de la parcela requiere comprobación.', sourceRefs: [1], appliesToParcel: 'unknown' as const, numericTokens: [] },
      ]
      const rendered = renderValidatedClaimsNeutral(claims)
      expect(rendered).toContain('La ordenanza aplicable es R-2.')
      expect(rendered).toContain('El Artículo 130 establece una superficie mínima de 5.000 m².')
      expect(rendered).toContain('La distribución espacial dentro de la parcela requiere comprobación.')
      expect(rendered).not.toContain('No puede fijarse todavía')
      expect(rendered).not.toContain('Normativa localizada cuya aplicación concreta')
      expect(rendered).not.toContain('Información cuya vinculación concreta')
    })

    it('keeps specific normative claims when territorial review marks the source', () => {
      const source: NormativeCandidate = {
        id: 'r2-source',
        content: 'Artículo 130. La parcela mínima es la establecida por la ordenanza.',
        evidenceSpecificity: 'SPECIFIC',
      }
      const output: ReasonerOutput = {
        answerMode: 'conditional',
        missingFacts: [],
        claims: [{
          id: 'r2-claim',
          type: 'normative_conditional',
          text: 'La ordenanza establece la parcela mínima si el ámbito espacial coincide.',
          sourceRefs: [1],
          appliesToParcel: 'conditional',
          numericTokens: [],
        }],
      }
      const applicability = { ...app, status: 'CONFLICTIVO' as const, review: [source], applicable: [], canAnswerConcreteParameters: false }
      expect(validateReasonerOutput(output, [source], applicability, undefined, undefined, true).validClaims).toHaveLength(1)
    })

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

    it('separates confirmed ordinance, accepted normative evidence and territorial uncertainty', () => {
      const canonicalSource: NormativeCandidate = {
        id: 'r2-130',
        content: 'Artículo 130. Ordenanza R-2. La parcela mínima es 5.000 m².',
        parentInstrument: '27387',
        identityId: '27387:ordinance:R-2',
        catalogStatus: 'ACCEPTED',
        evidenceSpecificity: 'SPECIFIC',
        normativeReferences: [{ documentId: '27387no101.pdf', chunkIds: ['r2-130'], article: 'Art. 130', relation: 'defines', sourceId: 'catalog' }],
      }
      const context = {
        qualification: { value: 'R-2', source: 'manual', verification: 'confirmed' },
        actionArea: { value: { surfaceSquareMetres: 100, selectionType: 'whole_parcel' }, verification: 'unverified' },
        knownConstraints: [], conflicts: [], pendingValidation: [],
      } as unknown as NormalizedParcelContext
      const prompt = buildMunicipalSafetyPrompt(
        context,
        { ...app, status: 'CONFLICTIVO', missingData: ['MISSING_REGIME_VALIDATION'] },
        [canonicalSource],
        'regime'
      )
      expect(prompt).toContain('Ordenanza aplicable confirmada en el expediente: R-2.')
      expect(prompt).toContain('identidad canónica validada 27387:ordinance:R-2; referencias Art. 130')
      expect(prompt).toContain('La situación territorial presenta heterogeneidad o una delimitación espacial pendiente.')
      expect(prompt).toContain('Identidad canónica validada y evidencia normativa específica')
      expect(prompt).toContain('Una incertidumbre parcial no invalida hechos independientes confirmados')
      expect(prompt).not.toContain('CONFLICTIVO')
      expect(prompt).not.toContain('MISSING_REGIME_VALIDATION')
      expect(prompt).not.toContain('USER_CONFIRMED')
      expect(prompt).not.toContain('actionAreaValidated')
      for (const internalState of [
        'DETERMINADO',
        'PARCIAL',
        'retrievalApplicabilityStatus',
        'hardStopReasonCodes',
        'mustAbstainBeforeLlm',
        'applicable',
        'rejected',
      ]) {
        expect(prompt).not.toContain(internalState)
      }
      expect(prompt).not.toContain('Aplicabilidad: REVISIÓN (no acreditada como aplicable a la parcela)')
    })

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

    it('rejects a parcel conclusion sourced only from non-specific document fallback', () => {
      const nonSpecificSource: NormativeCandidate = {
        ...applicableSource,
        evidenceSpecificity: 'NON_SPECIFIC',
      }
      const output: ReasonerOutput = {
        answerMode: 'definitive',
        missingFacts: [],
        claims: [{
          id: 'unsafe',
          type: 'parcel_conclusion',
          text: 'La ordenanza aplicable a esta parcela establece un retranqueo de 5 m',
          sourceRefs: [1],
          appliesToParcel: true,
          numericTokens: [],
        }],
      }
      const result = validateReasonerOutput(output, [nonSpecificSource], app)
      expect(result.validClaims).toHaveLength(0)
      expect(result.invalidClaimReasonCounts.NON_SPECIFIC_EVIDENCE).toBe(1)
    })

    it('labels document fallback as non-specific in the production prompt', () => {
      const nonSpecificSource: NormativeCandidate = {
        ...applicableSource,
        evidenceSpecificity: 'NON_SPECIFIC',
      }
      const prompt = buildMunicipalSafetyPrompt(
        {} as NormalizedParcelContext,
        app,
        [nonSpecificSource]
      )
      expect(prompt).toContain('Contenido general del instrumento/documentos')
      expect(prompt).toContain('no demuestra por sí solo la ordenanza')
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
      const municipalPrompt = buildMunicipalSafetyPrompt(context, reviewApplicability, [reviewSource], 'regime')
      const reviewPrompt = buildReviewSafetyPrompt(context, [reviewSource], 'regime')
      expect(municipalPrompt).toContain('Correspondencia de la fuente: La correspondencia espacial con la parcela requiere verificación adicional.')
      expect(reviewPrompt).toContain('Aplicabilidad: REVISIÓN')
      expect(municipalPrompt).toContain('Instrumento:')
      expect(municipalPrompt).toContain('Fuente:')
      expect(reviewPrompt).toContain('Instrumento:')
    })

    it('exposes provisional trust without exposing the internal enum', () => {
      const context = { knownConstraints: [], conflicts: [], pendingValidation: [] } as NormalizedParcelContext
      const provisional = { ...reviewSource, trustLevel: 'OFFICIAL_SCOPED_PROVISIONAL' as const }
      const prompt = buildMunicipalSafetyPrompt(context, { ...app, review: [], canAnswerConcreteParameters: false }, [provisional])
      expect(prompt).toContain('Fuente oficial acotada; pendiente de revisión jurídica humana')
      expect(prompt).toContain('nunca debe presentarse como revisada jurídicamente')
      expect(prompt).not.toContain('OFFICIAL_SCOPED_PROVISIONAL')
    })
  })
})
