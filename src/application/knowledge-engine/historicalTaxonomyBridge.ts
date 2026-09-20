export interface HistoricalTaxonomyBridgeInput {
  approvalDate?: string | null
  cla_homo?: string | null
  cat_homo?: string | null
  cla_ley?: string | null
  cat_ley?: string | null
  cat_wiug?: string | null
  instrumentType?: string | null
  /** Terms explicitly detected in official plan metadata, when available. */
  detectedHistoricalTerms?: readonly string[]
}

export interface HistoricalTaxonomyBridgeResult {
  canonicalCurrentIdentity: {
    classification?: string
    category?: string
  }
  originalPlanSearchTerms: string[]
  historicalConcepts: string[]
  confidence: 'high' | 'medium' | 'low' | 'none'
  provenance: string[]
}

const HISTORICAL_STRUCTURAL_TERMS = [
  'Suelo Urbano',
  'Ordenanzas zonales',
  'Unidades de Actuación Urbanística',
  'PERI',
]

function clean(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function isHistoricalPlan(input: HistoricalTaxonomyBridgeInput) {
  const type = clean(input.instrumentType)?.toLocaleLowerCase('es') ?? ''
  if (/normas\s+subsidiarias|\bnnss\b/.test(type)) return true
  const year = Number.parseInt(clean(input.approvalDate)?.slice(0, 4) ?? '', 10)
  return Number.isFinite(year) && year < 2000
}

export function buildHistoricalTaxonomyBridge(
  input: HistoricalTaxonomyBridgeInput,
): HistoricalTaxonomyBridgeResult {
  const classification = clean(input.cla_homo)
  const category = clean(input.cat_homo)
  const legalClassification = clean(input.cla_ley)
  const legalCategory = clean(input.cat_ley)
  const currentIdentity = {
    ...(classification ? { classification } : {}),
    ...(category ? { category } : {}),
  }

  if (!isHistoricalPlan(input) || !category || legalClassification || legalCategory) {
    return {
      canonicalCurrentIdentity: currentIdentity,
      originalPlanSearchTerms: [],
      historicalConcepts: [],
      confidence: 'none',
      provenance: [],
    }
  }

  const detectedTerms = (input.detectedHistoricalTerms ?? [])
    .map(clean)
    .filter((term): term is string => Boolean(term))
  const terms = [...new Set([...detectedTerms, ...HISTORICAL_STRUCTURAL_TERMS])]
  return {
    canonicalCurrentIdentity: currentIdentity,
    originalPlanSearchTerms: terms,
    historicalConcepts: terms,
    confidence: detectedTerms.length > 0 ? 'medium' : 'low',
    provenance: [
      detectedTerms.length > 0 ? 'official_historical_terms' : 'historical_instrument_vocabulary',
      'modern_homogeneous_category_without_legal_category',
    ],
  }
}

export function expandHistoricalTaxonomyQuery(
  question: string,
  bridge: HistoricalTaxonomyBridgeResult,
) {
  if (bridge.originalPlanSearchTerms.length === 0) return question
  return `${question}\n\nVocabulario original del instrumento histórico para recuperar evidencia (no sustituye la pregunta ni prueba una ordenanza): ${bridge.originalPlanSearchTerms.join(', ')}`
}
