import type {
  FactualComposerCaveat,
  FactualComposerConclusionKind,
  FactualComposerEvidence,
  FactualComposerExplanation,
  FactualComposerPlan,
  FactualComposerRecommendedCheck,
} from './factualComposerTypes'

const CONCLUSION_KINDS = new Set<FactualComposerConclusionKind>([
  'not_strictly_homogeneous',
  'strictly_homogeneous',
  'category_distribution',
  'category_identity',
  'classification_identity',
  'state_summary',
])
const EXPLANATION_KINDS = new Set<FactualComposerExplanation['kind']>([
  'fact_identity',
  'category_share',
  'geometric_dominance',
])
const CAVEAT_KINDS = new Set<FactualComposerCaveat['kind']>([
  'conflict',
  'unresolved',
  'manual_review_required',
  'manual_determination',
  'automatic_status',
  'automatic_determination',
])
const CHECK_KINDS = new Set<FactualComposerRecommendedCheck>([
  'verify_minority_area',
  'confirm_pending_determination',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, allowed: string[]) {
  const keys = Object.keys(value)
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key))
}

export function parseFactualComposerPlan(value: unknown): FactualComposerPlan | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    'schemaVersion', 'conclusion', 'explanation', 'caveats', 'recommendedChecks',
  ])) return null
  if (value.schemaVersion !== '1') return null
  if (!isRecord(value.conclusion)) return null
  const conclusionKeys = value.conclusion.targetFactId === undefined
    ? ['kind']
    : ['kind', 'targetFactId']
  if (!hasExactKeys(value.conclusion, conclusionKeys)) return null
  if (!CONCLUSION_KINDS.has(value.conclusion.kind as FactualComposerConclusionKind)) return null
  if (
    value.conclusion.targetFactId !== undefined &&
    (typeof value.conclusion.targetFactId !== 'string' || value.conclusion.targetFactId.length > 100)
  ) return null
  if (!Array.isArray(value.explanation) || value.explanation.length > 20) return null
  if (!Array.isArray(value.caveats) || value.caveats.length > 12) return null
  if (!Array.isArray(value.recommendedChecks) || value.recommendedChecks.length > 4) return null

  for (const item of value.explanation) {
    if (!isRecord(item) || !hasExactKeys(item, ['kind', 'factId'])) return null
    if (!EXPLANATION_KINDS.has(item.kind as FactualComposerExplanation['kind'])) return null
    if (typeof item.factId !== 'string' || item.factId.length > 100) return null
  }
  for (const item of value.caveats) {
    if (!isRecord(item) || !hasExactKeys(item, ['kind', 'factId'])) return null
    if (!CAVEAT_KINDS.has(item.kind as FactualComposerCaveat['kind'])) return null
    if (typeof item.factId !== 'string' || item.factId.length > 100) return null
  }
  if (!value.recommendedChecks.every((item) => CHECK_KINDS.has(item as FactualComposerRecommendedCheck))) {
    return null
  }

  return value as unknown as FactualComposerPlan
}

function expectedConclusion(evidence: FactualComposerEvidence) {
  switch (evidence.questionIntent) {
    case 'strict_homogeneity': return null
    case 'category_distribution': return 'category_distribution'
    case 'category_identity': return 'category_identity'
    case 'classification_identity': return 'classification_identity'
    case 'state_explanation': return 'state_summary'
  }
}

function hasExplanation(
  plan: FactualComposerPlan,
  kind: FactualComposerExplanation['kind'],
  factId: string
) {
  return plan.explanation.some((item) => item.kind === kind && item.factId === factId)
}

function hasCaveat(plan: FactualComposerPlan, kind: FactualComposerCaveat['kind']) {
  return plan.caveats.some((item) => item.kind === kind)
}

export interface FactualComposerSafetyResult {
  safe: boolean
  reason?: string
}

export function validateFactualComposerPlan(
  plan: FactualComposerPlan,
  evidence: FactualComposerEvidence
): FactualComposerSafetyResult {
  const facts = new Map(evidence.validatedFacts.map((fact) => [fact.id, fact]))
  if (evidence.validatedFacts.some((fact) => fact.scope !== evidence.scope)) {
    return { safe: false, reason: 'scope_mismatch' }
  }

  const refs = [
    ...plan.explanation.map((item) => item.factId),
    ...plan.caveats.map((item) => item.factId),
    ...(plan.conclusion.targetFactId ? [plan.conclusion.targetFactId] : []),
  ]
  if (refs.some((id) => !facts.has(id))) return { safe: false, reason: 'unknown_fact' }
  if (new Set(plan.explanation.map((item) => `${item.kind}:${item.factId}`)).size !== plan.explanation.length) {
    return { safe: false, reason: 'duplicate_explanation' }
  }
  if (new Set(plan.caveats.map((item) => `${item.kind}:${item.factId}`)).size !== plan.caveats.length) {
    return { safe: false, reason: 'duplicate_caveat' }
  }
  if (new Set(plan.recommendedChecks).size !== plan.recommendedChecks.length) {
    return { safe: false, reason: 'duplicate_check' }
  }

  const expected = expectedConclusion(evidence)
  if (expected && plan.conclusion.kind !== expected) {
    return { safe: false, reason: 'wrong_conclusion' }
  }

  const categories = evidence.validatedFacts.filter((fact) => fact.type === 'category')
  const classifications = evidence.validatedFacts.filter((fact) => fact.type === 'classification')
  if (evidence.questionIntent === 'strict_homogeneity') {
    const target = plan.conclusion.targetFactId
      ? facts.get(plan.conclusion.targetFactId)
      : undefined
    if (!target || target.type !== 'category') return { safe: false, reason: 'missing_target' }
    const positiveCategories = categories.filter((fact) => (fact.percentage ?? 0) > 0)
    const notStrict = positiveCategories.length > 1 || target.percentage === undefined || target.percentage < 100
    const expectedKind = notStrict ? 'not_strictly_homogeneous' : 'strictly_homogeneous'
    if (plan.conclusion.kind !== expectedKind) return { safe: false, reason: 'homogeneity_contradiction' }
  }

  const materialFacts = evidence.questionIntent === 'classification_identity'
    ? classifications
    : evidence.questionIntent === 'category_identity'
      ? [...classifications, ...categories]
      : evidence.questionIntent === 'state_explanation'
        ? evidence.validatedFacts
        : categories
  for (const fact of materialFacts) {
    const requiredKind = fact.type === 'category' && fact.percentage !== undefined &&
      (evidence.questionIntent === 'category_distribution' || evidence.questionIntent === 'strict_homogeneity')
      ? 'category_share'
      : 'fact_identity'
    if (!hasExplanation(plan, requiredKind, fact.id)) {
      return { safe: false, reason: 'material_fact_omitted' }
    }
  }

  const maximumPercentage = Math.max(...categories.map((fact) => fact.percentage ?? -Infinity))
  for (const item of plan.explanation) {
    const fact = facts.get(item.factId)!
    if (item.kind === 'category_share' && (fact.type !== 'category' || fact.percentage === undefined)) {
      return { safe: false, reason: 'unsupported_percentage' }
    }
    if (
      item.kind === 'geometric_dominance' &&
      (!fact.geometricDominance || fact.percentage === undefined || fact.percentage <= 50 || fact.percentage !== maximumPercentage)
    ) return { safe: false, reason: 'invalid_dominance' }
  }
  for (const fact of categories.filter((item) => item.geometricDominance)) {
    if (!hasExplanation(plan, 'geometric_dominance', fact.id)) {
      return { safe: false, reason: 'dominance_omitted' }
    }
  }

  const materialStates = {
    conflict: evidence.validatedFacts.some((fact) => fact.status === 'conflict'),
    unresolved: evidence.validatedFacts.some(
      (fact) => fact.status === 'unresolved' || fact.determination === 'unresolved'
    ),
    manual_review_required: evidence.validatedFacts.some(
      (fact) => fact.status === 'manual_review_required'
    ),
    manual_determination: evidence.validatedFacts.some((fact) => fact.determination === 'manual'),
    automatic_status: evidence.validatedFacts.some((fact) => fact.status?.startsWith('automatic_')),
    automatic_determination: evidence.validatedFacts.some(
      (fact) => fact.determination === 'automatic'
    ),
  }
  for (const [kind, required] of Object.entries(materialStates)) {
    if (required && !hasCaveat(plan, kind as FactualComposerCaveat['kind'])) {
      return { safe: false, reason: `${kind}_omitted` }
    }
  }
  for (const caveat of plan.caveats) {
    const fact = facts.get(caveat.factId)!
    const supported =
      (caveat.kind === 'conflict' && fact.status === 'conflict') ||
      (caveat.kind === 'unresolved' && (fact.status === 'unresolved' || fact.determination === 'unresolved')) ||
      (caveat.kind === 'manual_review_required' && fact.status === 'manual_review_required') ||
      (caveat.kind === 'manual_determination' && fact.determination === 'manual') ||
      (caveat.kind === 'automatic_status' && fact.status?.startsWith('automatic_')) ||
      (caveat.kind === 'automatic_determination' && fact.determination === 'automatic')
    if (!supported) return { safe: false, reason: 'unsupported_caveat' }
  }

  if (plan.recommendedChecks.includes('verify_minority_area')) {
    const positive = categories.filter((fact) => (fact.percentage ?? 0) > 0)
    if (positive.length < 2) return { safe: false, reason: 'unsupported_minority_check' }
  }
  if (plan.recommendedChecks.includes('confirm_pending_determination')) {
    if (!materialStates.conflict && !materialStates.unresolved && !materialStates.manual_review_required) {
      return { safe: false, reason: 'unsupported_confirmation_check' }
    }
  }

  return { safe: true }
}
