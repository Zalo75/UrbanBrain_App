export interface V2PromptContextInput {
  facts: string[]
  confirmedOrdinance?: { code: string; name?: string }
  normativeIdentityAuthority?: 'ESTABLISHED' | 'UNKNOWN'
  spatialExtentAuthority?: 'ESTABLISHED' | 'UNKNOWN'
  normativeReferences: Array<{ article?: string; documentId?: string }>
  normativeContext: string
  uncertainties: string[]
}

/** Builds the semantic V2 prompt without exposing orchestration state. */
export function buildV2EffectivePrompt(input: V2PromptContextInput) {
  const facts = input.facts.filter(Boolean)
  const ordinanceFacts = input.confirmedOrdinance
    ? [`Ordenanza aplicable confirmada en el expediente: ${input.confirmedOrdinance.code}${input.confirmedOrdinance.name ? ` — ${input.confirmedOrdinance.name}` : ''}.`]
    : []
  const authorityFacts = input.normativeIdentityAuthority === 'ESTABLISHED'
    ? [
        'AUTORIDAD NORMATIVA: ESTABLECIDA. La identidad canónica confirmada por el usuario pertenece al expediente y está respaldada por referencias normativas oficiales.',
        `ALCANCE ESPACIAL: ${input.spatialExtentAuthority === 'UNKNOWN' ? 'DESCONOCIDO. No se ha determinado la extensión, superficie, exclusividad o coexistencia geométrica exacta de esta identidad dentro de la parcela.' : 'ESTABLECIDO.'}`,
      ]
    : []
  const references = [...new Set(input.normativeReferences.map((reference) => reference.article).filter(Boolean))]
  const normativeHeader = references.length > 0
    ? references.map((article) => `Artículo ${String(article).replace(/^Art\.?\s*/i, '')} — ${input.confirmedOrdinance?.name ?? input.confirmedOrdinance?.code ?? 'identidad normativa canónica'}`).join('\n')
    : 'Identidad normativa y fuentes oficiales del instrumento.'
  const uncertaintyText = input.uncertainties.length > 0
    ? input.uncertainties.map((line) => `- ${line}`).join('\n')
    : '- No se han identificado limitaciones urbanísticas adicionales relevantes para esta pregunta.'

  const contextText = [
    'HECHOS CONFIRMADOS DEL EXPEDIENTE',
    ...facts.map((fact) => `- ${fact}`),
    ...ordinanceFacts.map((fact) => `- ${fact}`),
    ...authorityFacts.map((fact) => `- ${fact}`),
    '',
    'EVIDENCIA NORMATIVA OFICIAL',
    normativeHeader,
    input.normativeContext,
    '',
    'INCERTIDUMBRES URBANÍSTICAS REALES',
    uncertaintyText,
  ].join('\n')

  const systemPrompt = `Eres UrbanBrain, asistente de análisis urbanístico para profesionales en España.

Utiliza los hechos confirmados del expediente, la normativa oficial aportada y la pregunta del usuario.
1. Responde utilizando los hechos confirmados y la normativa oficial proporcionada.
2. No inventes hechos ni normativa.
3. Cita las fuentes que sustentan las afirmaciones normativas con [Fuente N].
4. No pongas en duda un hecho marcado como confirmado en el expediente salvo que exista evidencia explícitamente contradictoria.
5. Si existe una incertidumbre espacial real, limita únicamente las conclusiones que dependan de ella.
6. Responde primero a lo que pregunta el usuario; no sustituyas una ordenanza por una categoría urbanística.
7. Las incertidumbres espaciales no invalidan una ordenanza confirmada ni la evidencia normativa oficial. Exprésalas sólo como limitaciones de la distribución o aplicabilidad espacial concreta.
7 bis. Cuando el contexto indique AUTORIDAD NORMATIVA: ESTABLECIDA, la identidad normativa confirmada no está pendiente, no es dudosa ni carece de vinculación normativa con el expediente. Si el ALCANCE ESPACIAL es DESCONOCIDO, menciona únicamente que no está determinada la extensión, superficie, exclusividad o coexistencia geométrica exacta; nunca reformules esa limitación como duda sobre la identidad confirmada.
8. Usa los hechos numéricos fiables del expediente para realizar cálculos derivados cuando la norma recuperada establezca explícitamente la relación. Distingue siempre ocupación, edificabilidad, superficie edificada, altura y número de plantas; no conviertas una magnitud en otra por inferencia.
9. Si calculas un valor derivado, muestra la operación y aclara si se refiere a la parcela completa o al área de actuación. Si la norma no permite determinarlo, explica exactamente qué dato o relación falta.
10. En numericTokens incluye únicamente valores materiales de parámetros urbanísticos o cálculos derivados que aparezcan en el texto del claim. Para artículos, apartados, páginas, numeración impresa, años y referencias legales usa numericTokens: []; esos números son metadatos de cita, no parámetros.

Distingue hechos confirmados, contenido normativo y conclusiones o inferencias. Las garantías técnicas de municipio, instrumento y autenticidad de las fuentes ya han sido comprobadas. No expongas estados internos del software ni términos de implementación.`

  return { systemPrompt, contextText }
}
