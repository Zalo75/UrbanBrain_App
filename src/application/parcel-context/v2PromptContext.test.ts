import { describe, expect, it } from 'vitest'
import { buildV2EffectivePrompt } from './v2PromptContext'

describe('V2 effective regime prompt', () => {
  it('exposes confirmed facts and normative evidence without internal states', () => {
    const result = buildV2EffectivePrompt({
      facts: ['Municipio: Teo (INE 15082).', 'Instrumento de planeamiento: PXOM de Teo.'],
      confirmedOrdinance: { code: 'R-2', name: 'Solo Rústico de Especial Protección Agropecuaria' },
      normativeIdentityAuthority: 'ESTABLISHED',
      spatialExtentAuthority: 'UNKNOWN',
      normativeReferences: [{ article: 'Art. 130', documentId: '27387no101.pdf' }],
      normativeContext: '[Fuente 1]\nArtículo 130. Ordenanza R-2. La superficie mínima es 5.000 m².',
      uncertainties: ['La parcela presenta heterogeneidad territorial y la distribución espacial requiere verificación.'],
    })

    expect(result.contextText).toContain('HECHOS CONFIRMADOS DEL EXPEDIENTE')
    expect(result.contextText).toContain('Ordenanza aplicable confirmada en el expediente: R-2')
    expect(result.contextText).toContain('Artículo 130 — Solo Rústico de Especial Protección Agropecuaria')
    expect(result.contextText).toContain('INCERTIDUMBRES URBANÍSTICAS REALES')
    expect(result.contextText).toContain('AUTORIDAD NORMATIVA: ESTABLECIDA')
    expect(result.contextText).toContain('ALCANCE ESPACIAL: DESCONOCIDO')
    expect(result.systemPrompt).toContain('no invalidan una ordenanza confirmada')
    expect(result.systemPrompt).toContain('nunca reformules esa limitación como duda sobre la identidad confirmada')
    expect(result.systemPrompt).toContain('En numericTokens incluye únicamente valores materiales')
    for (const state of ['CONFLICTIVO', 'MISSING_REGIME_VALIDATION', 'WHOLE_PARCEL', 'hardStopReasonCodes', 'mustAbstainBeforeLlm', 'retrievalApplicabilityStatus']) {
      expect(`${result.systemPrompt}\n${result.contextText}`).not.toContain(state)
    }
  })

  it('does not manufacture an ordinance when none is confirmed', () => {
    const result = buildV2EffectivePrompt({
      facts: ['Municipio: Teo (INE 15082).'],
      normativeReferences: [],
      normativeContext: '[Fuente 1]\nTexto oficial.',
      uncertainties: [],
    })
    expect(result.contextText).not.toContain('Ordenanza aplicable confirmada en el expediente:')
    expect(result.contextText).toContain('Identidad normativa y fuentes oficiales del instrumento.')
    expect(result.contextText).not.toContain('AUTORIDAD NORMATIVA: ESTABLECIDA')
  })

  it('expone simultáneamente superficies de parcela y área operativa al razonador', () => {
    const result = buildV2EffectivePrompt({
      facts: [
        'Superficie de parcela: 3370.29 m².',
        'Superficie del área de actuación: 3348.12 m².',
      ],
      confirmedOrdinance: { code: 'R-2' },
      normativeReferences: [{ article: '130.4', documentId: '27387no304.pdf' }],
      normativeContext: 'Artículo 130.4: ocupación máxima del 20%; altura máxima de dos plantas.',
      uncertainties: [],
    })

    expect(result.contextText).toContain('Superficie de parcela: 3370.29 m².')
    expect(result.contextText).toContain('Superficie del área de actuación: 3348.12 m².')
    expect(result.systemPrompt).toContain('Distingue siempre ocupación, edificabilidad')
  })
})
