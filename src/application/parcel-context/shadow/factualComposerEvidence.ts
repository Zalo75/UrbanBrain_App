import type { TerritorialFactualContract } from '@/domain/parcel-context/factualContract'
import { resolveFactRef } from './resolveFactRef'
import type { StructuredFactualOutput, StructuredOperation } from './structuredFactualOutput'
import { analyzeVisibleFactualIntent } from './visibleFactualRouting'
import type {
  FactualComposerEvidence,
  FactualComposerFact,
  FactualComposerIntent,
  FactualComposerRequestedFactType,
} from './factualComposerTypes'

function composerIntent(
  question: string,
  contract: TerritorialFactualContract
): FactualComposerIntent | null {
  const intent = analyzeVisibleFactualIntent(question, contract)
  if (intent.asksConfirmation) return 'strict_homogeneity'
  if (intent.asksDistribution) return 'category_distribution'
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
  }
}
