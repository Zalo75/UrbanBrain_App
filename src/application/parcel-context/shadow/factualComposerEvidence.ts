import type { TerritorialFactualContract } from '@/domain/parcel-context/factualContract'
import { resolveFactRef } from './resolveFactRef'
import type { StructuredFactualOutput, StructuredOperation } from './structuredFactualOutput'
import { analyzeVisibleFactualIntent } from './visibleFactualRouting'
import type {
  FactualComposerEvidence,
  FactualComposerFact,
  FactualComposerIntent,
  FactualComposerPlan,
  FactualComposerRequestedFactType,
} from './factualComposerTypes'

function buildRequiredPlan(
  questionIntent: FactualComposerIntent,
  facts: FactualComposerFact[]
): FactualComposerPlan {
  const categories = facts.filter((fact) => fact.type === 'category')
  const classifications = facts.filter((fact) => fact.type === 'classification')
  const target = categories.find((fact) => fact.geometricDominance) ??
    [...categories].sort((left, right) => (right.percentage ?? -1) - (left.percentage ?? -1))[0]
  const positiveCategories = categories.filter((fact) => (fact.percentage ?? 0) > 0)
  const strictTotality = categories.length === 1 && Boolean(
    target && (target.coverage === 'full' || target.percentage === 100)
  )

  const conclusion: FactualComposerPlan['conclusion'] = questionIntent === 'strict_homogeneity'
    ? {
        kind: strictTotality ? 'strictly_homogeneous' : 'not_strictly_homogeneous',
        ...(target ? { targetFactId: target.id } : {}),
      }
    : questionIntent === 'category_distribution'
      ? { kind: 'category_distribution' }
      : questionIntent === 'category_identity'
        ? { kind: 'category_identity' }
        : questionIntent === 'classification_identity'
          ? { kind: 'classification_identity' }
          : { kind: 'state_summary' }

  const materialFacts = questionIntent === 'classification_identity'
    ? classifications
    : questionIntent === 'category_identity'
      ? [...classifications, ...categories]
      : questionIntent === 'state_explanation'
        ? facts
        : categories
  const extentRequested = questionIntent === 'category_distribution' ||
    questionIntent === 'strict_homogeneity'
  const explanation: FactualComposerPlan['explanation'] = materialFacts.map((fact) =>
    fact.type === 'category' && extentRequested
      ? fact.percentage !== undefined
        ? { kind: 'category_share' as const, factId: fact.id }
        : fact.coverage !== undefined
          ? { kind: 'territorial_coverage' as const, factId: fact.id }
          : { kind: 'fact_identity' as const, factId: fact.id }
      : { kind: 'fact_identity' as const, factId: fact.id }
  )
  explanation.push(...materialFacts
    .filter((fact) => fact.geometricDominance)
    .map((fact) => ({ kind: 'geometric_dominance' as const, factId: fact.id })))

  const caveats: FactualComposerPlan['caveats'] = []
  const addFirstSupported = (
    kind: FactualComposerPlan['caveats'][number]['kind'],
    predicate: (fact: FactualComposerFact) => boolean
  ) => {
    const fact = facts.find(predicate)
    if (fact) caveats.push({ kind, factId: fact.id } as FactualComposerPlan['caveats'][number])
  }
  addFirstSupported('conflict', (fact) => fact.status === 'conflict')
  addFirstSupported('unresolved', (fact) => fact.status === 'unresolved' || fact.determination === 'unresolved')
  addFirstSupported('manual_review_required', (fact) => fact.status === 'manual_review_required')
  addFirstSupported('manual_determination', (fact) => fact.determination === 'manual')
  addFirstSupported('automatic_status', (fact) => Boolean(fact.status?.startsWith('automatic_')))
  addFirstSupported('automatic_determination', (fact) => fact.determination === 'automatic')

  const hasPendingState = caveats.some((item) =>
    item.kind === 'conflict' || item.kind === 'unresolved' || item.kind === 'manual_review_required'
  )
  const recommendedChecks: FactualComposerPlan['recommendedChecks'] = positiveCategories.length > 1
    ? ['verify_minority_area']
    : hasPendingState
      ? ['confirm_pending_determination']
      : []

  return { schemaVersion: '1', conclusion, explanation, caveats, recommendedChecks }
}

function composerIntent(
  question: string,
  contract: TerritorialFactualContract
): FactualComposerIntent | null {
  const intent = analyzeVisibleFactualIntent(question, contract)
  if (intent.asksConfirmation) return 'strict_homogeneity'
  if (intent.asksDistribution) return 'category_distribution'
  if (intent.asksGeometry) return 'category_distribution'
  if (intent.asksCategory) return 'category_identity'
  if (intent.asksClassification) return 'classification_identity'
  if (intent.asksState) return 'state_explanation'
  return null
}

function factId(operation: StructuredOperation) {
  const ref = operation.factRef
  return ref.type === 'category'
    ? `category:${ref.scope}:${ref.code}`
    : ref.type === 'classification'
      ? `classification:${ref.scope}`
      : null
}

function includesFactType(
  intent: FactualComposerIntent,
  type: StructuredOperation['factRef']['type']
) {
  if (type === 'classification') {
    return intent === 'classification_identity' || intent === 'category_identity' || intent === 'state_explanation'
  }
  if (type !== 'category') return false
  return intent !== 'classification_identity'
}

function addRequestedType(
  requested: Set<FactualComposerRequestedFactType>,
  operation: StructuredOperation
) {
  requested.add(operation.factRef.type as 'classification' | 'category')
  if (operation.operation === 'state_percentage') requested.add('percentage')
  if (operation.operation === 'state_coverage') requested.add('coverage')
  if (operation.operation === 'state_geometric_dominance') {
    requested.add('percentage')
    requested.add('geometricDominance')
  }
  if (
    operation.operation === 'state_status' ||
    operation.operation === 'state_conflict' ||
    operation.operation === 'state_unresolved'
  ) requested.add('status')
  if (operation.operation === 'state_determination') requested.add('determination')
}

export function buildFactualComposerEvidence(
  question: string,
  contract: TerritorialFactualContract,
  output: StructuredFactualOutput
): FactualComposerEvidence | null {
  const questionIntent = composerIntent(question, contract)
  if (!questionIntent) return null
  const scope = analyzeVisibleFactualIntent(question, contract).scope
  if (output.abstentions.length > 0) return null
  if (output.operations.some((operation) => operation.factRef.scope !== scope)) return null

  const facts = new Map<string, FactualComposerFact>()
  const requestedFactTypes = new Set<FactualComposerRequestedFactType>()

  for (const operation of output.operations) {
    if (!includesFactType(questionIntent, operation.factRef.type)) continue
    const id = factId(operation)
    if (!id) continue
    const resolution = resolveFactRef(operation.factRef, contract)
    if (resolution.result !== 'one') return null
    const resolved = resolution.fact
    const current = facts.get(id) ?? {
      id,
      type: operation.factRef.type as 'classification' | 'category',
      scope,
      geometricDominance: false,
    }

    if ('code' in resolved && resolved.code) current.code = resolved.code
    if (
      'label' in resolved &&
      resolved.label &&
      'semanticCompleteness' in resolved &&
      resolved.semanticCompleteness === 'complete'
    ) current.label = resolved.label

    if (
      (operation.operation === 'state_percentage' ||
        operation.operation === 'state_geometric_dominance') &&
      'parcelPercentage' in resolved &&
      resolved.parcelPercentage !== undefined
    ) current.percentage = resolved.parcelPercentage

    if (
      operation.operation === 'state_coverage' &&
      'coverage' in resolved &&
      resolved.coverage === operation.coverage
    ) current.coverage = resolved.coverage

    if (
      (operation.operation === 'state_status' ||
        operation.operation === 'state_conflict' ||
        operation.operation === 'state_unresolved') &&
      'status' in resolved
    ) current.status = resolved.status

    if (operation.operation === 'state_determination' && 'determination' in resolved) {
      current.determination = resolved.determination
    }
    if (operation.operation === 'state_geometric_dominance') {
      current.geometricDominance = true
    }

    addRequestedType(requestedFactTypes, operation)
    facts.set(id, current)
  }

  const validatedFacts = [...facts.values()]
  const hasRequiredFacts = questionIntent === 'classification_identity'
    ? validatedFacts.some((fact) => fact.type === 'classification')
    : questionIntent === 'state_explanation'
      ? validatedFacts.length > 0
      : validatedFacts.some((fact) => fact.type === 'category')
  if (!hasRequiredFacts) return null

  return {
    schemaVersion: '1',
    questionIntent,
    scope,
    requestedFactTypes: [...requestedFactTypes],
    validatedFacts,
    requiredPlan: buildRequiredPlan(questionIntent, validatedFacts),
  }
}
