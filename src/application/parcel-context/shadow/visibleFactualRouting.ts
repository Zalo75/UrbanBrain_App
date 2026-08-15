import type { TerritorialFactualContract } from '@/domain/parcel-context/factualContract'
import type { TerritorialShadowResult } from './shadowPipeline'

export type FactualScope = 'parcel' | 'actionArea'

export interface VisibleFactualIntentAnalysis {
  scope: FactualScope
  asksCategory: boolean
  asksClassification: boolean
  asksGeometry: boolean
  asksDistribution: boolean
  asksConfirmation: boolean
  asksState: boolean
}

function normalizeQuestion(question: string) {
  return question
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

const NORMATIVE_OR_PARAMETER_PATTERN =
  /\b(?:edificabilidad|ocupacion|retranqueos?|alturas?|numero de plantas|plantas|parcela minima|frente minimo|usos?|materiales?|fachadas?|condiciones esteticas?|ordenanzas?|articulos?|normativa|regulacion|cte|licencias?|consecuencias juridicas?|consecuencias normativas?|interpretacion normativa)\b/u

const CATEGORY_PATTERN = /\bcategor(?:ia|ias)\b/u
const CLASSIFICATION_PATTERN = /\b(?:clasificacion|clase de suelo|tipo de suelo|regimen urbanistico)\b/u
const TERRITORIAL_REGIME_PATTERN = /\bregimen\b/u
const TERRITORIAL_SUBJECT_PATTERN =
  /\b(?:categor(?:ia|ias)|clasificacion|clase de suelo|tipo de suelo|regimen|suelo|parcela|finca|area|zona|ambito)\b/u
const TERRITORIAL_GEOMETRY_PATTERN =
  /\b(?:porcentaje|porcentajes|reparto|reparte|reparten|distribucion|distribuye|distribuyen|predomina|predominio|mayor presencia geometrica|que parte|cuanto corresponde)\b/u
const TERRITORIAL_DISTRIBUTION_PATTERN =
  /\b(?:porcentajes|reparto|reparte|reparten|distribucion|distribuye|distribuyen|predomina|predominio|mayor presencia geometrica)\b|\b(?:que parte|porcentaje|cuanto corresponde)\b.{0,80}\b(?:cada categoria|categorias)\b/u
const TERRITORIAL_STATE_PATTERN =
  /\b(?:estado|conflicto|conflictiva|confirmada|confirmado|confirmar|verificada|verificado|resuelta|resuelto|pendiente|sin resolver|no resuelta|no resuelto|unresolved|determinacion|revision)\b/u
const TERRITORIAL_CONFIRMATION_PATTERN =
  /\b(?:puedo considerar|puede considerarse|puede confirmarse|misma categoria|mas de una categoria)\b|\b(?:parcela|finca|area|zona|ambito)\b.{0,80}\b(?:es|son|pertenece|pertenecen|se clasifica)\b.{0,40}\b(?:snr[a-z0-9]*|suelo|categoria|clasificacion)\b/u
const PARCEL_SCOPE_PATTERN = /\b(?:parcela|finca)\b/u
const ACTION_AREA_SCOPE_PATTERN =
  /\b(?:area|zona|ambito)\s+(?:de actuacion\s+)?(?:seleccionada|seleccionado|marcada|marcado)\b|\b(?:esta zona|esta area|(?:area|zona) que (?:he|tengo|esta) marcad[ao]|zona de trabajo)\b/u

function asksTerritorialRegime(normalized: string) {
  return TERRITORIAL_REGIME_PATTERN.test(normalized) &&
    (PARCEL_SCOPE_PATTERN.test(normalized) || ACTION_AREA_SCOPE_PATTERN.test(normalized))
}

function hasExtentFacts(contract: TerritorialFactualContract, scope: FactualScope) {
  return Boolean(contract.factsByScope?.[scope]?.categories?.some(
    (category) => category.parcelPercentage !== undefined || category.coverage !== undefined
  ))
}

export function requestedScope(question: string, contract: TerritorialFactualContract): FactualScope {
  const normalized = normalizeQuestion(question)
  if (PARCEL_SCOPE_PATTERN.test(normalized)) return 'parcel'
  if (ACTION_AREA_SCOPE_PATTERN.test(normalized)) return 'actionArea'
  if (TERRITORIAL_GEOMETRY_PATTERN.test(normalized)) {
    const parcelHasExtent = hasExtentFacts(contract, 'parcel')
    const actionAreaHasExtent = hasExtentFacts(contract, 'actionArea')
    if (parcelHasExtent !== actionAreaHasExtent) {
      return parcelHasExtent ? 'parcel' : 'actionArea'
    }
  }
  return contract.factsByScope?.actionArea ? 'actionArea' : 'parcel'
}

export function analyzeVisibleFactualIntent(
  question: string,
  contract: TerritorialFactualContract
): VisibleFactualIntentAnalysis {
  const normalized = normalizeQuestion(question)
  const scope = requestedScope(question, contract)
  const asksCategory = CATEGORY_PATTERN.test(normalized)
  const asksClassification = CLASSIFICATION_PATTERN.test(normalized) || asksTerritorialRegime(normalized)
  const asksGeometry = TERRITORIAL_GEOMETRY_PATTERN.test(normalized)
  const asksConfirmation = TERRITORIAL_CONFIRMATION_PATTERN.test(normalized)
  const asksState = TERRITORIAL_STATE_PATTERN.test(normalized)
  const asksDistribution = TERRITORIAL_DISTRIBUTION_PATTERN.test(normalized) || (
    scope === 'parcel' && /\bcategorias\b/u.test(normalized)
  )

  return {
    scope,
    asksCategory,
    asksClassification,
    asksGeometry,
    asksDistribution,
    asksConfirmation,
    asksState,
  }
}

function hasCoveredFacts(question: string, contract: TerritorialFactualContract) {
  const intent = analyzeVisibleFactualIntent(question, contract)
  const scopeFacts = contract.factsByScope?.[intent.scope]
  if (!scopeFacts) return false

  if (intent.asksGeometry) {
    return Boolean(scopeFacts.categories?.some(
      (category) => category.parcelPercentage !== undefined || category.coverage !== undefined
    ))
  }
  if (intent.asksCategory || intent.asksConfirmation) return Boolean(scopeFacts.categories?.length)
  if (intent.asksClassification) return Boolean(scopeFacts.classification)

  return Boolean(scopeFacts.classification || scopeFacts.categories?.length)
}

export function isSynchronousFactualEnabled(value = process.env.URBANBRAIN_SYNC_FACTUAL_ENABLED) {
  return value === 'true'
}

export function shouldRunVisibleFactual(
  question: string,
  contract: TerritorialFactualContract
) {
  const normalized = normalizeQuestion(question)
  if (NORMATIVE_OR_PARAMETER_PATTERN.test(normalized)) return false

  const hasFactualIntent =
    CATEGORY_PATTERN.test(normalized) ||
    CLASSIFICATION_PATTERN.test(normalized) ||
    asksTerritorialRegime(normalized) ||
    TERRITORIAL_GEOMETRY_PATTERN.test(normalized) ||
    TERRITORIAL_CONFIRMATION_PATTERN.test(normalized) ||
    (TERRITORIAL_STATE_PATTERN.test(normalized) && TERRITORIAL_SUBJECT_PATTERN.test(normalized))

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
  if (result.diagnostics.metrics?.coverageComplete === false) {
    return {
      answer: null,
      fallbackReason: `coverage:${result.diagnostics.metrics.coverageReason ?? 'incomplete'}`,
    }
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
