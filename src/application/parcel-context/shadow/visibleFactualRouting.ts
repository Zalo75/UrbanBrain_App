import type { TerritorialFactualContract } from '@/domain/parcel-context/factualContract'
import type { TerritorialShadowResult } from './shadowPipeline'

type FactualScope = 'parcel' | 'actionArea'

const NORMATIVE_OR_PARAMETER_PATTERN =
  /\b(?:edificabilidad|ocupaci[oó]n(?:\s+m[aá]xima)?|retranqueos?|altura|n[uú]mero\s+de\s+plantas|plantas|parcela\s+m[ií]nima|frente\s+m[ií]nimo|usos?\s+(?:permitidos?|compatibles?|prohibidos?)|materiales?|condiciones?\s+est[eé]ticas?|ordenanza|art[ií]culos?|normativa|regulaci[oó]n|cte|licencias?|consecuencias?\s+(?:jur[ií]dicas?|normativas?))\b/iu

const TERRITORIAL_IDENTITY_PATTERN =
  /\b(?:clasificaci[oó]n|categor[ií]as?|clase\s+de\s+suelo|tipo\s+de\s+suelo)\b/iu

const TERRITORIAL_GEOMETRY_PATTERN =
  /\b(?:porcentajes?|distribuci[oó]n\s+geom[eé]trica|predomina|predominio|mayor\s+presencia\s+geom[eé]trica|qu[eé]\s+parte\s+(?:corresponde|ocupa|representa))\b/iu

const TERRITORIAL_STATE_PATTERN =
  /\b(?:conflicto|conflictiva?|sin\s+resolver|no\s+resuelt[ao]|unresolved|determinaci[oó]n|estado\s+(?:territorial|de\s+la\s+(?:clasificaci[oó]n|categor[ií]a)))\b/iu

const TERRITORIAL_CONFIRMATION_PATTERN =
  /\b(?:puedo\s+considerar|puede\s+considerarse|puede\s+confirmarse|confirmar)\b[\s\S]{0,100}\b(?:parcela|finca|[aá]rea|suelo|n[uú]cleo|urbano|r[uú]stico)\b|\b(?:toda\s+la\s+parcela|parcela\s+(?:catastral\s+)?completa|[aá]rea\s+(?:de\s+actuaci[oó]n\s+)?seleccionada)\b[\s\S]{0,80}\b(?:es|pertenece|se\s+clasifica)\b/iu

const PARCEL_SCOPE_PATTERN =
  /\b(?:toda\s+la\s+parcela|parcela\s+(?:catastral\s+)?completa|conjunto\s+de\s+la\s+parcela|toda\s+la\s+finca|finca\s+completa|independientemente\s+del\s+[aá]rea)\b/iu

const ACTION_AREA_SCOPE_PATTERN =
  /(?:^|\s)(?:[aá]rea\s+(?:de\s+actuaci[oó]n\s+)?seleccionada|[aá]rea\s+que\s+(?:tengo|est[aá])\s+seleccionada|[aá]mbito\s+seleccionado|zona\s+de\s+trabajo)(?=\s|[?¿,.!:;]|$)/iu

function requestedScope(question: string, contract: TerritorialFactualContract): FactualScope {
  if (PARCEL_SCOPE_PATTERN.test(question)) return 'parcel'
  if (ACTION_AREA_SCOPE_PATTERN.test(question)) return 'actionArea'
  return contract.factsByScope?.actionArea ? 'actionArea' : 'parcel'
}

function hasCoveredFacts(question: string, contract: TerritorialFactualContract) {
  const scopeFacts = contract.factsByScope?.[requestedScope(question, contract)]
  if (!scopeFacts) return false

  const asksGeometry = TERRITORIAL_GEOMETRY_PATTERN.test(question)
  const asksCategory = /\bcategor[ií]as?\b/iu.test(question)
  const asksClassification = /\bclasificaci[oó]n|clase\s+de\s+suelo|tipo\s+de\s+suelo\b/iu.test(question)
  const asksConfirmation = TERRITORIAL_CONFIRMATION_PATTERN.test(question)

  if (asksGeometry) {
    return Boolean(scopeFacts.categories?.some((category) => category.parcelPercentage !== undefined))
  }
  if (asksCategory || asksConfirmation) return Boolean(scopeFacts.categories?.length)
  if (asksClassification) return Boolean(scopeFacts.classification)

  return Boolean(scopeFacts.classification || scopeFacts.categories?.length)
}

export function isSynchronousFactualEnabled(value = process.env.URBANBRAIN_SYNC_FACTUAL_ENABLED) {
  return value === 'true'
}

export function shouldRunVisibleFactual(
  question: string,
  contract: TerritorialFactualContract
) {
  if (NORMATIVE_OR_PARAMETER_PATTERN.test(question)) return false

  const hasFactualIntent =
    TERRITORIAL_IDENTITY_PATTERN.test(question) ||
    TERRITORIAL_GEOMETRY_PATTERN.test(question) ||
    TERRITORIAL_STATE_PATTERN.test(question) ||
    TERRITORIAL_CONFIRMATION_PATTERN.test(question)

  return hasFactualIntent && hasCoveredFacts(question, contract)
}

export function visibleFactualAnswer(result: TerritorialShadowResult): string | null {
  return assessVisibleFactualResult(result).answer
}

export interface VisibleFactualAssessment {
  answer: string | null
  fallbackReason: string | null
}

export function assessVisibleFactualResult(
  result: TerritorialShadowResult
): VisibleFactualAssessment {
  if (result.status !== 'valid') {
    return { answer: null, fallbackReason: `pipeline_${result.status}` }
  }
  if (result.structuredOutput?.abstentions.length) {
    const causes = [...new Set(result.structuredOutput.abstentions.map((item) => item.cause))]
    return { answer: null, fallbackReason: `abstention:${causes.join(',')}` }
  }
  if (!result.structuredOutput?.operations.length) {
    return { answer: null, fallbackReason: 'no_operations' }
  }

  const rendered = result.renderedText
    ?.map((line) => line.trim())
    .filter(Boolean)

  if (!rendered?.length) return { answer: null, fallbackReason: 'rendered_empty' }
  return { answer: rendered.join('\n\n'), fallbackReason: null }
}
