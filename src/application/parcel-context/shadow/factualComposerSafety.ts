import type {
  FactualComposerCaveat,
  FactualComposerConclusionKind,
  FactualComposerEvidence,
  FactualComposerExplanation,
  FactualComposerPlan,
  FactualComposerRecommendedCheck,
  FactualComposerSafetyErrorCode,
  FactualComposerSchemaError,
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
  'territorial_coverage',
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

function valueType(value: unknown): NonNullable<FactualComposerSchemaError['valueType']> {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value as NonNullable<FactualComposerSchemaError['valueType']>
}

function safeInvalidEnum(value: unknown) {
  return typeof value === 'string' && /^[a-z_]{1,48}$/.test(value) ? value : undefined
}

function safePropertyPath(path: string, key: string) {
  return /^[A-Za-z][A-Za-z0-9_]{0,48}$/.test(key) ? `${path}.${key}` : `${path}.[additional]`
}

function additionalPropertyErrors(
  value: Record<string, unknown>,
  allowed: string[],
  path: string,
  errors: FactualComposerSchemaError[]
) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      errors.push({ code: 'additional_property', path: safePropertyPath(path, key) })
    }
  }
}

function requiredField(
  value: Record<string, unknown>,
  key: string,
  path: string,
  errors: FactualComposerSchemaError[]
) {
  if (!(key in value)) errors.push({ code: 'missing_required_field', path: `${path}.${key}` })
}

export type FactualComposerPlanParseResult =
  | { success: true; plan: FactualComposerPlan }
  | { success: false; errors: FactualComposerSchemaError[] }

export function parseFactualComposerPlanDetailed(value: unknown): FactualComposerPlanParseResult {
  const errors: FactualComposerSchemaError[] = []
  if (!isRecord(value)) {
    return { success: false, errors: [{ code: 'invalid_type', path: '$', valueType: valueType(value) }] }
  }

  additionalPropertyErrors(
    value,
    ['schemaVersion', 'conclusion', 'explanation', 'caveats', 'recommendedChecks'],
    '$',
    errors
  )
  requiredField(value, 'schemaVersion', '$', errors)
  requiredField(value, 'conclusion', '$', errors)
  if ('schemaVersion' in value && value.schemaVersion !== '1') {
    errors.push({ code: 'invalid_literal', path: '$.schemaVersion', valueType: valueType(value.schemaVersion) })
  }

  if ('conclusion' in value) {
    if (!isRecord(value.conclusion)) {
      errors.push({ code: 'invalid_type', path: '$.conclusion', valueType: valueType(value.conclusion) })
    } else {
      additionalPropertyErrors(value.conclusion, ['kind', 'targetFactId'], '$.conclusion', errors)
      requiredField(value.conclusion, 'kind', '$.conclusion', errors)
      if (
        'kind' in value.conclusion &&
        !CONCLUSION_KINDS.has(value.conclusion.kind as FactualComposerConclusionKind)
      ) {
        errors.push({
          code: typeof value.conclusion.kind === 'string' ? 'invalid_enum' : 'invalid_type',
          path: '$.conclusion.kind',
          valueType: valueType(value.conclusion.kind),
          invalidEnum: safeInvalidEnum(value.conclusion.kind),
        })
      }
      if (
        'targetFactId' in value.conclusion &&
        (typeof value.conclusion.targetFactId !== 'string' || value.conclusion.targetFactId.length > 100)
      ) {
        errors.push({ code: 'invalid_type', path: '$.conclusion.targetFactId', valueType: valueType(value.conclusion.targetFactId) })
      }
    }
  }

  const explanation = 'explanation' in value ? value.explanation : []
  const caveats = 'caveats' in value ? value.caveats : []
  const recommendedChecks = 'recommendedChecks' in value ? value.recommendedChecks : []
  const validateFactItems = (
    items: unknown,
    path: '$.explanation' | '$.caveats',
    kinds: Set<string>,
    maximum: number
  ) => {
    if (!Array.isArray(items)) {
      errors.push({ code: 'invalid_type', path, valueType: valueType(items) })
      return
    }
    if (items.length > maximum) {
      errors.push({ code: 'invalid_type', path, valueType: 'array' })
    }
    items.forEach((item, index) => {
      const itemPath = `${path}[${index}]`
      if (!isRecord(item)) {
        errors.push({ code: 'invalid_type', path: itemPath, valueType: valueType(item) })
        return
      }
      additionalPropertyErrors(item, ['kind', 'factId'], itemPath, errors)
      requiredField(item, 'kind', itemPath, errors)
      requiredField(item, 'factId', itemPath, errors)
      if ('kind' in item && !kinds.has(item.kind as string)) {
        errors.push({
          code: typeof item.kind === 'string' ? 'invalid_enum' : 'invalid_type',
          path: `${itemPath}.kind`,
          valueType: valueType(item.kind),
          invalidEnum: safeInvalidEnum(item.kind),
        })
      }
      if ('factId' in item && (typeof item.factId !== 'string' || item.factId.length > 100)) {
        errors.push({ code: 'invalid_type', path: `${itemPath}.factId`, valueType: valueType(item.factId) })
      }
    })
  }
  validateFactItems(explanation, '$.explanation', EXPLANATION_KINDS, 20)
  validateFactItems(caveats, '$.caveats', CAVEAT_KINDS, 12)

  if (!Array.isArray(recommendedChecks)) {
    errors.push({ code: 'invalid_type', path: '$.recommendedChecks', valueType: valueType(recommendedChecks) })
  } else {
    if (recommendedChecks.length > 4) {
      errors.push({ code: 'invalid_type', path: '$.recommendedChecks', valueType: 'array' })
    }
    recommendedChecks.forEach((item, index) => {
      if (!CHECK_KINDS.has(item as FactualComposerRecommendedCheck)) {
        errors.push({
          code: typeof item === 'string' ? 'invalid_enum' : 'invalid_type',
          path: `$.recommendedChecks[${index}]`,
          valueType: valueType(item),
          invalidEnum: safeInvalidEnum(item),
        })
      }
    })
  }

  if (errors.length > 0) return { success: false, errors }

  return {
    success: true,
    plan: {
      schemaVersion: '1',
      conclusion: value.conclusion as FactualComposerPlan['conclusion'],
      explanation: explanation as FactualComposerExplanation[],
      caveats: caveats as FactualComposerCaveat[],
      recommendedChecks: recommendedChecks as FactualComposerRecommendedCheck[],
    },
  }
}

export function parseFactualComposerPlan(value: unknown): FactualComposerPlan | null {
  const result = parseFactualComposerPlanDetailed(value)
  return result.success ? result.plan : null
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
  reason?: FactualComposerSafetyErrorCode
}

export function validateFactualComposerPlan(
  plan: FactualComposerPlan,
  evidence: FactualComposerEvidence
): FactualComposerSafetyResult {
  const facts = new Map(evidence.validatedFacts.map((fact) => [fact.id, fact]))
  if (evidence.validatedFacts.some((fact) => fact.scope !== evidence.scope)) {
    return { safe: false, reason: 'wrong_scope' }
  }

  const refs = [
    ...plan.explanation.map((item) => item.factId),
    ...plan.caveats.map((item) => item.factId),
    ...(plan.conclusion.targetFactId ? [plan.conclusion.targetFactId] : []),
  ]
  const hasWrongScopeRef = refs.some((id) => {
    const scope = id.split(':')[1]
    return (scope === 'parcel' || scope === 'actionArea') && scope !== evidence.scope
  })
  if (hasWrongScopeRef) return { safe: false, reason: 'wrong_scope' }
  if (refs.some((id) => !facts.has(id))) return { safe: false, reason: 'unknown_fact_ref' }
  if (new Set(plan.explanation.map((item) => `${item.kind}:${item.factId}`)).size !== plan.explanation.length) {
    return { safe: false, reason: 'duplicate_plan_item' }
  }
  if (new Set(plan.caveats.map((item) => `${item.kind}:${item.factId}`)).size !== plan.caveats.length) {
    return { safe: false, reason: 'duplicate_plan_item' }
  }
  if (new Set(plan.recommendedChecks).size !== plan.recommendedChecks.length) {
    return { safe: false, reason: 'duplicate_plan_item' }
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
    const hasAccreditedTotality = target.coverage === 'full' || target.percentage === 100
    const notStrict = categories.length > 1 || positiveCategories.length > 1 || !hasAccreditedTotality
    const expectedKind = notStrict ? 'not_strictly_homogeneous' : 'strictly_homogeneous'
    if (plan.conclusion.kind !== expectedKind) return { safe: false, reason: 'categorical_totality' }
  }

  const materialFacts = evidence.questionIntent === 'classification_identity'
    ? classifications
    : evidence.questionIntent === 'category_identity'
      ? [...classifications, ...categories]
      : evidence.questionIntent === 'state_explanation'
        ? evidence.validatedFacts
        : categories
  for (const fact of materialFacts) {
    const extentRequested = evidence.questionIntent === 'category_distribution' ||
      evidence.questionIntent === 'strict_homogeneity'
    const requiredKind = fact.type === 'category' && extentRequested
      ? fact.percentage !== undefined
        ? 'category_share'
        : fact.coverage !== undefined
          ? 'territorial_coverage'
          : 'fact_identity'
      : 'fact_identity'
    if (!hasExplanation(plan, requiredKind, fact.id)) {
      return { safe: false, reason: fact.type === 'category' ? 'missing_material_category' : 'missing_material_fact' }
    }
  }

  const maximumPercentage = Math.max(...categories.map((fact) => fact.percentage ?? -Infinity))
  for (const item of plan.explanation) {
    const fact = facts.get(item.factId)!
    if (item.kind === 'category_share' && (fact.type !== 'category' || fact.percentage === undefined)) {
      return { safe: false, reason: 'unsupported_percentage' }
    }
    if (item.kind === 'territorial_coverage' && (fact.type !== 'category' || fact.coverage === undefined)) {
      return { safe: false, reason: 'unsupported_coverage' }
    }
    if (
      item.kind === 'geometric_dominance' &&
      (!fact.geometricDominance || fact.percentage === undefined || fact.percentage <= 50 || fact.percentage !== maximumPercentage)
    ) return { safe: false, reason: 'dominance_mismatch' }
  }
  for (const fact of categories.filter((item) => item.geometricDominance)) {
    if (!hasExplanation(plan, 'geometric_dominance', fact.id)) {
      return { safe: false, reason: 'missing_dominance' }
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
      const reason: FactualComposerSafetyErrorCode = kind === 'conflict'
        ? 'missing_conflict'
        : kind === 'unresolved'
          ? 'missing_unresolved'
          : kind.startsWith('automatic_')
            ? 'missing_automatic_state'
            : 'missing_manual_state'
      return { safe: false, reason }
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
    if (positive.length < 2) return { safe: false, reason: 'unsupported_check' }
  }
  if (plan.recommendedChecks.includes('confirm_pending_determination')) {
    if (!materialStates.conflict && !materialStates.unresolved && !materialStates.manual_review_required) {
      return { safe: false, reason: 'unsupported_check' }
    }
  }

  return { safe: true }
}
