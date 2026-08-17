import type {
  ApplicabilityResult,
  NormalizedParcelContext,
  NormativeCandidate,
  ReasonerClaim,
  ReasonerOutput,
} from '@/domain/parcel-context/types'
import type { ParcelQuestionScope } from './applicabilityEngine'

export type QuestionIntent =
  | 'parcel_parameter'
  | 'parcel_viability'
  | 'parcel_regime'
  | 'normative_information'
  | 'mixed'

export type ClaimRelevanceCode = 'DIRECT' | 'SUPPORTING' | 'CONTEXT_ONLY' | 'IRRELEVANT'
export type ClaimSemanticRole = 'PRIMARY' | 'SUPPORTING' | 'CONTEXT' | 'LIMITATION' | 'IRRELEVANT'
export type SemanticFallbackReason =
  | 'NO_APPLICABLE_PARAMETER_EVIDENCE'
  | 'CONDITIONAL_VIABILITY_ONLY'
  | 'NO_RELEVANT_PRIMARY_CLAIM'

export interface ClaimRelevanceEvaluation {
  code: ClaimRelevanceCode
  role: ClaimSemanticRole
  reason: string
}

export interface SemanticCompositionResult {
  answer: string
  questionIntent: QuestionIntent
  primaryClaimCount: number
  contextClaimCount: number
  irrelevantClaimCount: number
  semanticFallbackUsed: boolean
  semanticFallbackReason: SemanticFallbackReason | null
  evaluations: Array<{ claimId: string; evaluation: ClaimRelevanceEvaluation }>
}

const PARAMETER_PATTERNS: Array<[string, RegExp]> = [
  ['retranqueo', /\bretranque(?:o|os)\b/i],
  ['ocupación', /\bocupaci[oó]n\b/i],
  ['altura', /\baltura(?:\s+m[aá]xima)?\b/i],
  ['edificabilidad', /\bedificabilidad\b/i],
  ['parcela mínima', /\bparcela\s+m[ií]nima\b/i],
  ['frente mínimo', /\bfrente\s+m[ií]nimo\b/i],
  ['alineación', /\balineaci[oó]n\b/i],
  ['usos', /\busos?\s+(?:urban[ií]sticos?|permitidos?|compatibles?|prohibidos?)\b/i],
  ['plantas', /\b(?:n[uú]mero\s+de|cu[aá]ntas?)\s+plantas?\b/i],
  ['categoría', /\b(?:categor[ií]a|calificaci[oó]n|ordenanza|zona|[aá]mbito)\b/i],
]

const NORMATIVE_INFORMATION_PATTERN = /\b(?:art(?:[ií]culo)?\.?\s*\d+|art[ií]culo\b|normativa\b|documentos?\b|fuentes?\b|regulaci[oó]n\b|ordenanza\b)\b/i
const SANCTION_PATTERN = /\b(?:multa|sanci[oó]n|sancionador|infracci[oó]n|procedimiento\s+sancionador|porcentaje\s+del\s+valor\s+de\s+la\s+obra)\b/i
const VIABILITY_PATTERN = /\b(?:construir|edificable|edificaci[oó]n|viabilidad|uso\s+pretendido|uso\s+permitido|categor[ií]a|calificaci[oó]n)\b/i

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
}

function hasApplicableEvidence(claim: ReasonerClaim, sources: NormativeCandidate[], applicability: ApplicabilityResult) {
  const reviewIds = new Set((applicability.review ?? []).map((candidate) => candidate.id))
  return claim.sourceRefs.some((ref) => {
    const source = sources[ref - 1]
    return Boolean(source && !reviewIds.has(source.id))
  })
}

function isReviewOnly(claim: ReasonerClaim, sources: NormativeCandidate[], applicability: ApplicabilityResult) {
  const reviewIds = new Set((applicability.review ?? []).map((candidate) => candidate.id))
  return claim.sourceRefs.length > 0 && claim.sourceRefs.every((ref) => reviewIds.has(sources[ref - 1]?.id ?? ''))
}

function requestedParameter(question: string) {
  return PARAMETER_PATTERNS.find(([, pattern]) => pattern.test(question))?.[0]
}

function claimMatchesParameter(claim: ReasonerClaim, question: string) {
  const parameter = requestedParameter(question)
  if (!parameter) return true
  const pattern = PARAMETER_PATTERNS.find(([name]) => name === parameter)?.[1]
  return Boolean(pattern?.test(claim.text))
}

function claimIsMateriallyViable(claim: ReasonerClaim) {
  return VIABILITY_PATTERN.test(claim.text) && !SANCTION_PATTERN.test(claim.text)
}

function isSpeculativeHypothesis(claim: ReasonerClaim) {
  const text = normalize(claim.text)
  return /\b(?:si\s+(?:se\s+trata|existe|es|la\s+parcela|el\s+ambito|suelo)|en\s+(?:el\s+)?supuesto|en\s+(?:el\s+)?caso\s+de\s+(?:que|tratarse)|dependera\s+de|podria|salvo\s+que)\b/.test(text)
}

export function classifyQuestionIntent(
  question: string,
  questionScope: ParcelQuestionScope,
  concreteParameterRequested: boolean,
  conditionalViabilityRequested: boolean
): QuestionIntent {
  const normalizedQuestion = normalize(question)
  const asksNormativeInformation = NORMATIVE_INFORMATION_PATTERN.test(normalizedQuestion)
  const asksRegime = /\b(?:clasificacion|categoria\s+(?:urbanistica|del\s+suelo)|calificacion|ordenanza|zona|ambito)\b/i.test(normalizedQuestion)
  const hasParameterAndViability = concreteParameterRequested && conditionalViabilityRequested

  if (questionScope === 'mixed' || hasParameterAndViability) return 'mixed'
  if (conditionalViabilityRequested) return 'parcel_viability'
  if (asksNormativeInformation && !concreteParameterRequested) return 'normative_information'
  if (asksRegime && !requestedParameter(question)) return 'parcel_regime'
  if (concreteParameterRequested) return 'parcel_parameter'
  if (asksNormativeInformation) return 'normative_information'
  if (questionScope === 'regime') return 'parcel_regime'
  return 'normative_information'
}

export function evaluateClaimRelevance(
  claim: ReasonerClaim,
  questionIntent: QuestionIntent,
  question: string,
  sources: NormativeCandidate[],
  applicability: ApplicabilityResult
): ClaimRelevanceEvaluation {
  if (claim.type === 'limitation') {
    return { code: 'SUPPORTING', role: 'LIMITATION', reason: 'limitation-material' }
  }

  const applicable = hasApplicableEvidence(claim, sources, applicability)
  const reviewOnly = isReviewOnly(claim, sources, applicability)
  const questionHasSanction = SANCTION_PATTERN.test(question)
  const claimHasSanction = SANCTION_PATTERN.test(claim.text)

  if (questionIntent === 'parcel_parameter') {
    if (!claimMatchesParameter(claim, question)) {
      return { code: 'IRRELEVANT', role: 'IRRELEVANT', reason: 'different-parameter' }
    }
    if (reviewOnly || !applicable) {
      return { code: 'CONTEXT_ONLY', role: 'CONTEXT', reason: 'review-not-parcel-applicable' }
    }
    if (
      claim.type === 'parcel_conclusion' ||
      claim.appliesToParcel === true ||
      claim.type === 'normative_conditional' ||
      claim.type === 'normative_fact'
    ) {
      if ((claim.type === 'normative_conditional' || claim.appliesToParcel === 'conditional') && isSpeculativeHypothesis(claim)) {
        return { code: 'SUPPORTING', role: 'SUPPORTING', reason: 'speculative-conditional' }
      }
      return { code: 'DIRECT', role: 'PRIMARY', reason: 'requested-parameter-applicable' }
    }
    return { code: 'SUPPORTING', role: 'SUPPORTING', reason: 'requested-parameter-support' }
  }

  if (questionIntent === 'parcel_viability') {
    if (claimHasSanction && !questionHasSanction) {
      return { code: 'IRRELEVANT', role: 'IRRELEVANT', reason: 'sanction-not-viability' }
    }
    if (reviewOnly) {
      return { code: 'CONTEXT_ONLY', role: 'CONTEXT', reason: 'review-not-parcel-applicable' }
    }
    if (claim.type === 'parcel_conclusion' && applicable) {
      return { code: 'DIRECT', role: 'PRIMARY', reason: 'authorized-viability-conclusion' }
    }
    if (claim.type === 'normative_conditional' && applicable && claimIsMateriallyViable(claim)) {
      if (isSpeculativeHypothesis(claim)) {
        return { code: 'SUPPORTING', role: 'SUPPORTING', reason: 'speculative-viability' }
      }
      return { code: 'DIRECT', role: 'PRIMARY', reason: 'conditional-viability-evidence' }
    }
    if ((claim.type === 'normative_fact' || claim.type === 'territorial_fact') && applicable && claimIsMateriallyViable(claim)) {
      return { code: 'SUPPORTING', role: 'SUPPORTING', reason: 'viability-support' }
    }
    return { code: 'IRRELEVANT', role: 'IRRELEVANT', reason: 'not-material-to-viability' }
  }

  if (questionIntent === 'normative_information') {
    if (claim.type === 'normative_fact' || claim.type === 'normative_conditional') {
      return { code: 'DIRECT', role: 'PRIMARY', reason: 'requested-normative-information' }
    }
    if (claim.type === 'territorial_fact') {
      return { code: 'SUPPORTING', role: 'SUPPORTING', reason: 'normative-context-support' }
    }
    return { code: 'CONTEXT_ONLY', role: 'CONTEXT', reason: 'non-normative-context' }
  }

  if (questionIntent === 'parcel_regime') {
    if (claim.type === 'territorial_fact' && claim.appliesToParcel === true && applicable) {
      return { code: 'DIRECT', role: 'PRIMARY', reason: 'parcel-regime-fact' }
    }
    if (claim.type === 'parcel_conclusion' && applicable) {
      return { code: 'DIRECT', role: 'PRIMARY', reason: 'parcel-regime-conclusion' }
    }
    if (reviewOnly) return { code: 'CONTEXT_ONLY', role: 'CONTEXT', reason: 'review-regime-context' }
    if (claim.type === 'normative_fact' || claim.type === 'normative_conditional') {
      return { code: 'SUPPORTING', role: 'SUPPORTING', reason: 'regime-normative-support' }
    }
    return { code: 'IRRELEVANT', role: 'IRRELEVANT', reason: 'not-regime-relevant' }
  }

  // Mixed questions keep both requested components, while unrelated claims stay hidden.
  if (claimHasSanction && !questionHasSanction) {
    return { code: 'IRRELEVANT', role: 'IRRELEVANT', reason: 'sanction-not-requested' }
  }
  if (reviewOnly) return { code: 'CONTEXT_ONLY', role: 'CONTEXT', reason: 'review-context' }
  if (
    claimMatchesParameter(claim, question) &&
    applicable &&
    (claim.type === 'parcel_conclusion' || claim.appliesToParcel === true || claim.type === 'normative_fact')
  ) {
    return { code: 'DIRECT', role: 'PRIMARY', reason: 'mixed-parameter-component' }
  }
  if (claimIsMateriallyViable(claim) && applicable && (claim.type === 'normative_conditional' || claim.type === 'parcel_conclusion')) {
    return { code: 'DIRECT', role: 'PRIMARY', reason: 'mixed-viability-component' }
  }
  if (claim.type === 'normative_fact' || claim.type === 'normative_conditional') {
    return { code: 'SUPPORTING', role: 'SUPPORTING', reason: 'mixed-support' }
  }
  return { code: 'IRRELEVANT', role: 'IRRELEVANT', reason: 'not-requested-component' }
}

function stripInlineCitations(text: string) {
  return text.replace(/\s*\[Fuente\s+\d+\]/gi, '').replace(/[ \t]{2,}/g, ' ').trim()
}

function renderClaim(claim: ReasonerClaim, prefix = '') {
  const text = stripInlineCitations(claim.text)
  const sentence = /[.!?]$/.test(text) ? text : `${text}.`
  const refs = [...new Set(claim.sourceRefs)].map((ref) => `[Fuente ${ref}]`).join(' ')
  return `- ${prefix}${sentence}${refs ? ` ${refs}` : ''}`
}

function parameterFallback(question: string) {
  const parameter = requestedParameter(question)
  const readableParameter: Record<string, string> = {
    retranqueo: 'el retranqueo',
    ocupación: 'la ocupación',
    altura: 'la altura',
    edificabilidad: 'la edificabilidad',
    'parcela mínima': 'la parcela mínima',
    'frente mínimo': 'el frente mínimo',
    alineación: 'la alineación',
    usos: 'los usos urbanísticos',
    plantas: 'el número de plantas',
    categoría: 'la categoría urbanística',
  }
  const label = parameter ? readableParameter[parameter] ?? `el parámetro ${parameter}` : 'el parámetro urbanístico'
  return `No puede fijarse todavía ${label} aplicable a esta parcela con seguridad.`
}

function viabilityFallback(missingFacts: string[], context?: NormalizedParcelContext) {
  void missingFacts
  const classification = context?.urbanisticFacts?.classification

  if (classification?.status === 'automatic_confirmed' || classification?.status === 'technician_validated') {
    return `No puede confirmarse todavía la edificabilidad de la parcela de forma categórica. Su clasificación como ${classification.value?.label?.toLowerCase() ?? 'suelo'} está determinada, pero falta concretar la categoría o regulación específica necesaria para determinar los usos y condiciones aplicables.`
  }
  return 'La viabilidad urbanística de esta parcela no puede confirmarse todavía de forma categórica porque falta concretar el régimen urbanístico aplicable.'
}

export function humanizeMissingFacts(facts: string[]) {
  const labels: string[] = []
  const add = (label: string) => {
    if (!labels.includes(label)) labels.push(label)
  }

  for (const fact of facts) {
    const normalizedFact = normalize(fact)
    if (/clasificaci[oó]n|clase\s+de\s+suelo/.test(normalizedFact)) {
      add('La clasificación urbanística de la parcela.')
    }
    if (/categor[ií]a/.test(normalizedFact)) {
      add('La categoría de suelo aplicable.')
    }
    if (/calificaci[oó]n/.test(normalizedFact)) {
      add('La calificación urbanística concreta de la parcela.')
    }
    if (/ordenanza/.test(normalizedFact)) {
      add('La ordenanza urbanística aplicable.')
    }
    if (/[aá]mbito|\bzona\b/.test(normalizedFact)) {
      add('El ámbito o zona de ordenación correspondiente.')
    }
    if (/ficha/.test(normalizedFact)) {
      add('La ficha urbanística correspondiente, si existe.')
    }
    if (/evidencia\s+documental/.test(normalizedFact)) {
      add('Evidencia documental suficiente para confirmar la regla aplicable.')
    }
    if (
      !/clasificaci[oó]n|clase\s+de\s+suelo|categor[ií]a|calificaci[oó]n|ordenanza|[aá]mbito|\bzona\b|ficha|evidencia\s+documental/.test(
        normalizedFact
      )
    ) {
      add(fact.trim().replace(/[.;:]+$/, '') + '.')
    }
  }

  return labels
}

export function composeSemanticAnswer(
  output: ReasonerOutput,
  validClaims: ReasonerClaim[],
  question: string,
  questionIntent: QuestionIntent,
  sources: NormativeCandidate[],
  applicability: ApplicabilityResult,
  deterministicMissingFacts: string[],
  context?: NormalizedParcelContext
): SemanticCompositionResult {
  void output
  void context
  const evaluations = validClaims.map((claim) => ({
    claimId: claim.id,
    evaluation: evaluateClaimRelevance(claim, questionIntent, question, sources, applicability),
  }))
  const evaluationById = new Map(evaluations.map((item) => [item.claimId, item.evaluation]))
  const primaryClaims = validClaims.filter((claim) => evaluationById.get(claim.id)?.role === 'PRIMARY')
  const supportClaims = validClaims.filter((claim) => {
    const role = evaluationById.get(claim.id)?.role
    return role === 'SUPPORTING' || role === 'CONTEXT'
  })
  const limitationClaims = validClaims.filter((claim) => evaluationById.get(claim.id)?.role === 'LIMITATION')
  const irrelevantClaimCount = validClaims.filter((claim) => evaluationById.get(claim.id)?.role === 'IRRELEVANT').length

  let semanticFallbackReason: SemanticFallbackReason | null = null
  let fallbackText: string | null = null
  if (primaryClaims.length === 0) {
    if (questionIntent === 'parcel_parameter' && applicability.applicable.length === 0 && (applicability.review ?? []).length > 0) {
      semanticFallbackReason = 'NO_APPLICABLE_PARAMETER_EVIDENCE'
      fallbackText = parameterFallback(question)
    } else if (questionIntent === 'parcel_viability' && applicability.canAnswerConditionalViability) {
      semanticFallbackReason = 'CONDITIONAL_VIABILITY_ONLY'
      fallbackText = viabilityFallback(deterministicMissingFacts, context)
    } else {
      semanticFallbackReason = 'NO_RELEVANT_PRIMARY_CLAIM'
      fallbackText = limitationClaims[0] ? stripInlineCitations(limitationClaims[0].text) : 'La evidencia recuperada no permite cerrar una respuesta material a la pregunta.'
    }
  }

  const lines: string[] = ['CONCLUSIÓN']
  if (primaryClaims.length > 0) {
    primaryClaims.forEach((claim) => lines.push(renderClaim(claim)))
    if (deterministicMissingFacts.length > 0 && limitationClaims.length > 0) {
      lines.push(renderClaim(limitationClaims[0]))
    }
  } else if (fallbackText) lines.push(`- ${fallbackText}`)

  if (primaryClaims.length === 0 && limitationClaims.length > 0 && semanticFallbackReason === 'NO_RELEVANT_PRIMARY_CLAIM') {
    limitationClaims.slice(1).forEach((claim) => lines.push(renderClaim(claim)))
  }

  const contextClaims = primaryClaims.length === 0
    ? [...supportClaims, ...limitationClaims]
    : [...supportClaims, ...limitationClaims.slice(deterministicMissingFacts.length > 0 ? 1 : 0)]
  if (contextClaims.length > 0) {
    lines.push('', 'FUNDAMENTO')
    contextClaims.forEach((claim) => {
      const evaluation = evaluationById.get(claim.id)
      const prefix = evaluation?.role === 'CONTEXT'
        ? 'Normativa localizada cuya aplicación concreta a esta parcela no ha podido confirmarse: '
        : evaluation?.role === 'LIMITATION'
          ? 'Información cuya vinculación concreta con esta parcela sigue pendiente: '
          : ''
      lines.push(renderClaim(claim, prefix))
    })
  }

  const visibleMissingFacts = humanizeMissingFacts(deterministicMissingFacts)
  if (visibleMissingFacts.length > 0) {
    lines.push('', 'PENDIENTE DE COMPROBAR')
    visibleMissingFacts.forEach((fact) => lines.push(`- ${fact}`))
  }

  return {
    answer: lines.join('\n').trim(),
    questionIntent,
    primaryClaimCount: primaryClaims.length,
    contextClaimCount: contextClaims.length,
    irrelevantClaimCount,
    semanticFallbackUsed: semanticFallbackReason !== null,
    semanticFallbackReason,
    evaluations,
  }
}
