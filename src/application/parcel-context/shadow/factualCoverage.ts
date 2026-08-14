import type {
  FactualCategory,
  FactualClassification,
  TerritorialFactualContract,
} from '@/domain/parcel-context/factualContract'
import type {
  StructuredFactRef,
  StructuredFactualOutput,
  StructuredOperation,
} from './structuredFactualOutput'
import { analyzeVisibleFactualIntent, type FactualScope } from './visibleFactualRouting'

export type FactualCoverageReason =
  | 'not_required'
  | 'already_complete'
  | 'completed_deterministically'
  | 'missing_scope'
  | 'missing_required_facts'
  | 'scope_mismatch'
  | 'abstentions_present'
  | 'ambiguous_category'
  | 'unrepresentable_category'
  | 'unrepresentable_classification'

export interface FactualCoverageDiagnostics {
  coverageRequiredCount: number
  coverageSelectedCount: number
  coverageAddedCount: number
  coverageComplete: boolean
  coverageReason: FactualCoverageReason
}

export interface FactualCoverageResult {
  output: StructuredFactualOutput
  diagnostics: FactualCoverageDiagnostics
}

interface CoverageRequirement {
  isSatisfied: (operation: StructuredOperation) => boolean
  buildOperation: () => StructuredOperation | null
}

const COVERAGE_OPERATION_TYPES = new Set<StructuredOperation['operation']>([
  'reference_code',
  'state_label',
  'state_percentage',
  'state_geometric_dominance',
])

function unchanged(
  output: StructuredFactualOutput,
  complete: boolean,
  reason: FactualCoverageReason,
  requiredCount = 0,
  selectedCount = 0
): FactualCoverageResult {
  return {
    output,
    diagnostics: {
      coverageRequiredCount: requiredCount,
      coverageSelectedCount: selectedCount,
      coverageAddedCount: 0,
      coverageComplete: complete,
      coverageReason: reason,
    },
  }
}

function sameCategoryRef(
  operation: StructuredOperation,
  scope: FactualScope,
  code: string
) {
  return operation.factRef.type === 'category' &&
    operation.factRef.scope === scope &&
    operation.factRef.code === code
}

function categoryRequirement(
  category: FactualCategory,
  scope: FactualScope
): CoverageRequirement | null {
  if (!category.code) return null

  const factRef = { type: 'category', scope, code: category.code } as const
  if (category.parcelPercentage !== undefined) {
    return {
      isSatisfied: (operation) =>
        sameCategoryRef(operation, scope, category.code!) &&
        (operation.operation === 'state_percentage' || operation.operation === 'state_geometric_dominance'),
      buildOperation: () => ({
        operation: 'state_percentage',
        factRef,
        percentage: category.parcelPercentage!,
      }),
    }
  }

  return {
    isSatisfied: (operation) =>
      sameCategoryRef(operation, scope, category.code!) &&
      COVERAGE_OPERATION_TYPES.has(operation.operation),
    buildOperation: () =>
      category.semanticCompleteness === 'complete' && category.label
        ? { operation: 'state_label', factRef, label: category.label }
        : { operation: 'reference_code', factRef, code: category.code! },
  }
}

function classificationRequirement(
  classification: FactualClassification,
  scope: FactualScope
): CoverageRequirement | null {
  const factRef = { type: 'classification', scope } as const
  const operation = classification.semanticCompleteness === 'complete' && classification.label
    ? { operation: 'state_label', factRef, label: classification.label } as const
    : classification.code
      ? { operation: 'reference_code', factRef, code: classification.code } as const
      : null

  if (!operation) return null

  return {
    isSatisfied: (candidate) =>
      candidate.factRef.type === 'classification' &&
      candidate.factRef.scope === scope &&
      (candidate.operation === 'state_label' || candidate.operation === 'reference_code'),
    buildOperation: () => operation,
  }
}

function hasConflictOperation(operation: StructuredOperation, scope: FactualScope) {
  return operation.factRef.scope === scope && (
    operation.operation === 'state_conflict' ||
    (operation.operation === 'state_status' && operation.status === 'conflict')
  )
}

function hasUnresolvedOperation(operation: StructuredOperation, scope: FactualScope) {
  return operation.factRef.scope === scope && (
    operation.operation === 'state_unresolved' ||
    (operation.operation === 'state_status' && operation.status === 'unresolved') ||
    (operation.operation === 'state_determination' && operation.determination === 'unresolved')
  )
}

function stateRequirements(
  categories: FactualCategory[],
  scope: FactualScope
): CoverageRequirement[] {
  const requirements: CoverageRequirement[] = []
  const conflictCategory = categories.find((category) => category.code && category.status === 'conflict')
  if (conflictCategory?.code) {
    const factRef = { type: 'category', scope, code: conflictCategory.code } as const
    requirements.push({
      isSatisfied: (operation) => hasConflictOperation(operation, scope),
      buildOperation: () => ({ operation: 'state_conflict', factRef }),
    })
  }

  const unresolvedStatusCategory = categories.find(
    (category) => category.code && category.status === 'unresolved'
  )
  const unresolvedDeterminationCategory = categories.find(
    (category) => category.code && category.determination === 'unresolved'
  )
  const unresolvedCategory = unresolvedStatusCategory ?? unresolvedDeterminationCategory
  if (unresolvedCategory?.code) {
    const factRef = { type: 'category', scope, code: unresolvedCategory.code } as const
    requirements.push({
      isSatisfied: (operation) => hasUnresolvedOperation(operation, scope),
      buildOperation: () => unresolvedStatusCategory
        ? { operation: 'state_unresolved', factRef }
        : { operation: 'state_determination', factRef, determination: 'unresolved' },
    })
  }

  return requirements
}

function classificationStateRequirements(
  classification: FactualClassification,
  scope: FactualScope
): CoverageRequirement[] {
  const factRef: StructuredFactRef = { type: 'classification', scope }
  const requirements: CoverageRequirement[] = []
  if (classification.status === 'conflict') {
    requirements.push({
      isSatisfied: (operation) =>
        operation.factRef.type === 'classification' && hasConflictOperation(operation, scope),
      buildOperation: () => ({ operation: 'state_conflict', factRef }),
    })
  }
  if (classification.status === 'unresolved') {
    requirements.push({
      isSatisfied: (operation) =>
        operation.factRef.type === 'classification' && hasUnresolvedOperation(operation, scope),
      buildOperation: () => ({ operation: 'state_unresolved', factRef }),
    })
  } else if (classification.determination === 'unresolved') {
    requirements.push({
      isSatisfied: (operation) =>
        operation.factRef.type === 'classification' && hasUnresolvedOperation(operation, scope),
      buildOperation: () => ({
        operation: 'state_determination',
        factRef,
        determination: 'unresolved',
      }),
    })
  }
  return requirements
}

export function enforceFactualCoverage(
  question: string,
  contract: TerritorialFactualContract,
  output: StructuredFactualOutput
): FactualCoverageResult {
  const intent = analyzeVisibleFactualIntent(question, contract)
  const requiresCategoryCoverage =
    intent.asksCategory || intent.asksDistribution || intent.asksConfirmation
  const requiresClassificationCoverage = intent.asksClassification

  if (!requiresCategoryCoverage && !requiresClassificationCoverage) {
    return unchanged(output, true, 'not_required')
  }

  const scopeFacts = contract.factsByScope?.[intent.scope]
  if (!scopeFacts) return unchanged(output, false, 'missing_scope')

  if (output.operations.some((operation) => operation.factRef.scope !== intent.scope)) {
    return unchanged(output, false, 'scope_mismatch')
  }
  if (output.abstentions.length > 0) {
    return unchanged(output, false, 'abstentions_present')
  }

  const requirements: CoverageRequirement[] = []

  if (requiresClassificationCoverage) {
    if (!scopeFacts.classification) {
      return unchanged(output, false, 'missing_required_facts')
    }
    const requirement = classificationRequirement(scopeFacts.classification, intent.scope)
    if (!requirement) return unchanged(output, false, 'unrepresentable_classification')
    requirements.push(requirement)
  } else if (intent.asksCategory && scopeFacts.classification) {
    // Classification is useful context for category answers when representable, but it is
    // not a semantic prerequisite: never block valid categories because this auxiliary fact
    // lacks a safe label/code representation.
    const auxiliaryRequirement = classificationRequirement(scopeFacts.classification, intent.scope)
    if (auxiliaryRequirement) requirements.push(auxiliaryRequirement)
  }

  if (requiresCategoryCoverage) {
    const categories = scopeFacts.categories ?? []
    if (categories.length === 0) return unchanged(output, false, 'missing_required_facts')

    const codeCounts = new Map<string, number>()
    for (const category of categories) {
      if (!category.code) return unchanged(output, false, 'unrepresentable_category')
      codeCounts.set(category.code, (codeCounts.get(category.code) ?? 0) + 1)
    }
    if ([...codeCounts.values()].some((count) => count > 1)) {
      return unchanged(output, false, 'ambiguous_category')
    }

    for (const category of categories) {
      const requirement = categoryRequirement(category, intent.scope)
      if (!requirement) return unchanged(output, false, 'unrepresentable_category')
      requirements.push(requirement)
    }
    requirements.push(...stateRequirements(categories, intent.scope))
  } else if (intent.asksState && scopeFacts.classification) {
    requirements.push(...classificationStateRequirements(scopeFacts.classification, intent.scope))
  }

  const selectedCount = requirements.filter((requirement) =>
    output.operations.some(requirement.isSatisfied)
  ).length
  const additions: StructuredOperation[] = []

  for (const requirement of requirements) {
    if (output.operations.some(requirement.isSatisfied)) continue
    const operation = requirement.buildOperation()
    if (!operation) {
      return unchanged(output, false, 'missing_required_facts', requirements.length, selectedCount)
    }
    additions.push(operation)
  }

  const completedOutput = additions.length === 0
    ? output
    : { ...output, operations: [...output.operations, ...additions] }
  const complete = requirements.every((requirement) =>
    completedOutput.operations.some(requirement.isSatisfied)
  )

  return {
    output: completedOutput,
    diagnostics: {
      coverageRequiredCount: requirements.length,
      coverageSelectedCount: selectedCount,
      coverageAddedCount: additions.length,
      coverageComplete: complete,
      coverageReason: complete
        ? additions.length > 0 ? 'completed_deterministically' : 'already_complete'
        : 'missing_required_facts',
    },
  }
}
