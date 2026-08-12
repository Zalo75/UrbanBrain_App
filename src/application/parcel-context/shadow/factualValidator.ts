import type {
  FactualAffect,
  FactualAffectsState,
  FactualCandidate,
  FactualCategory,
  FactualClassification,
  FactualConsolidation,
  FactualPlanningArea,
  TerritorialFactualContract,
} from '@/domain/parcel-context/factualContract'
import type { SemanticCompleteness } from '@/domain/parcel-context/factualContract'
import type { StructuredFactualOutput, StructuredFactRef } from './structuredFactualOutput'

export type ValidationErrorCode =
  | 'INVALID_FACT_REF'
  | 'AMBIGUOUS_FACT_REF'
  | 'CODE_MISMATCH'
  | 'LABEL_HALLUCINATION'
  | 'LABEL_MISMATCH'
  | 'PERCENTAGE_MISMATCH'
  | 'STATUS_MISMATCH'
  | 'DETERMINATION_MISMATCH'
  | 'GEOMETRY_TO_EFFECTIVE'
  | 'UNRESOLVED_AS_ABSENCE'
  | 'SCOPE_MISMATCH'
  | 'INVALID_ABSTENTION'

export interface ValidationError {
  code: ValidationErrorCode
  message: string
  factRef?: StructuredFactRef
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: string[]
}

type ResolvedFact =
  | FactualAffect
  | FactualAffectsState
  | FactualCandidate
  | FactualCategory
  | FactualClassification
  | FactualConsolidation
  | FactualPlanningArea

type FactResolution =
  | { result: 'none' }
  | { result: 'one'; fact: ResolvedFact }
  | { result: 'ambiguous'; matchCount: number }

function resolveFactRef(ref: StructuredFactRef, contract: TerritorialFactualContract): FactResolution {
  const scopeFacts = contract.factsByScope?.[ref.scope]
  if (!scopeFacts) return { result: 'none' }

  let matches: ResolvedFact[]

  switch (ref.type) {
    case 'classification':
      matches = scopeFacts.classification ? [scopeFacts.classification] : []
      break
    case 'category':
      matches = (scopeFacts.categories ?? []).filter((category) => category.code === ref.code)
      break
    case 'category_candidate':
      matches = (scopeFacts.categories ?? [])
        .filter((category) => category.code === ref.categoryCode)
        .flatMap((category) => (category.candidates ?? []).filter((candidate) => candidate.code === ref.candidateCode))
      break
    case 'consolidation':
      matches = scopeFacts.consolidation ? [scopeFacts.consolidation] : []
      break
    case 'planning_area':
      matches = (scopeFacts.planningAreas ?? []).filter((planningArea) => planningArea.code === ref.code)
      break
    case 'affect':
      matches = (scopeFacts.affects?.items ?? []).filter((affect) => affect.label === ref.label)
      break
    case 'affects_state':
      matches = scopeFacts.affects ? [scopeFacts.affects] : []
      break
  }

  if (matches.length === 0) return { result: 'none' }
  if (matches.length > 1) return { result: 'ambiguous', matchCount: matches.length }
  return { result: 'one', fact: matches[0] }
}

export function validateStructuredFactualOutput(
  output: StructuredFactualOutput,
  contract: TerritorialFactualContract
): ValidationResult {
  const errors: ValidationError[] = []
  const warnings: string[] = []

  for (const op of output.operations) {
    const resolution = resolveFactRef(op.factRef, contract)

    if (resolution.result === 'none') {
      errors.push({
        code: 'INVALID_FACT_REF',
        message: `Fact reference not found in contract: ${JSON.stringify(op.factRef)}`,
        factRef: op.factRef,
      })
      continue
    }
    if (resolution.result === 'ambiguous') {
      errors.push({
        code: 'AMBIGUOUS_FACT_REF',
        message: `Fact reference matched ${resolution.matchCount} facts in scope ${op.factRef.scope}: ${JSON.stringify(op.factRef)}`,
        factRef: op.factRef,
      })
      continue
    }

    const fact = resolution.fact

    if (op.operation === 'reference_code') {
      const actualCode = 'code' in fact ? fact.code : undefined
      if (actualCode !== op.code) {
        errors.push({
          code: 'CODE_MISMATCH',
          message: `Expected code ${actualCode}, got ${op.code}`,
          factRef: op.factRef,
        })
      }
    }

    if (op.operation === 'state_label') {
      const semanticCompleteness: SemanticCompleteness | undefined =
        'semanticCompleteness' in fact ? fact.semanticCompleteness : undefined
      if (semanticCompleteness === 'partial' || semanticCompleteness === undefined) {
        errors.push({
          code: 'LABEL_HALLUCINATION',
          message: 'Cannot state label for a fact with partial completeness',
          factRef: op.factRef,
        })
      } else if (semanticCompleteness === 'complete') {
        const actualLabel = 'label' in fact ? fact.label : undefined
        if (actualLabel !== op.label) {
          errors.push({
            code: 'LABEL_MISMATCH',
            message: `Expected label ${actualLabel}, got ${op.label}`,
            factRef: op.factRef,
          })
        }
      }
    }

    if (op.operation === 'state_percentage') {
      if (!('parcelPercentage' in fact) || fact.parcelPercentage === undefined) {
        errors.push({ code: 'PERCENTAGE_MISMATCH', message: 'Fact does not have a percentage', factRef: op.factRef })
      } else {
        const diff = Math.abs(fact.parcelPercentage - op.percentage)
        if (diff > 0.01) {
          errors.push({
            code: 'PERCENTAGE_MISMATCH',
            message: `Expected percentage ${fact.parcelPercentage}, got ${op.percentage}`,
            factRef: op.factRef,
          })
        }
      }
    }

    if (op.operation === 'state_status') {
      const actualStatus = 'status' in fact ? fact.status : undefined
      if (actualStatus !== op.status) {
        errors.push({
          code: 'STATUS_MISMATCH',
          message: `Expected status ${actualStatus}, got ${op.status}`,
          factRef: op.factRef,
        })
      }
    }

    if (op.operation === 'state_determination') {
      const actualDetermination = 'determination' in fact ? fact.determination : undefined
      if (actualDetermination !== op.determination) {
        errors.push({
          code: 'DETERMINATION_MISMATCH',
          message: `Expected determination ${actualDetermination}, got ${op.determination}`,
          factRef: op.factRef,
        })
      }
    }

    if (op.operation === 'state_geometric_dominance') {
      if (!('parcelPercentage' in fact) || fact.parcelPercentage === undefined) {
        errors.push({
          code: 'PERCENTAGE_MISMATCH',
          message: 'Fact does not have a percentage for dominance',
          factRef: op.factRef,
        })
      } else {
        if (fact.parcelPercentage <= 50) {
          errors.push({
            code: 'PERCENTAGE_MISMATCH',
            message: 'Geometric dominance requires > 50%',
            factRef: op.factRef,
          })
        }
      }
    }

    if (op.operation === 'state_absence') {
      if (op.factRef.type === 'affects_state' && 'status' in fact) {
        if (fact.status === 'unresolved' || fact.status === 'conflict') {
          errors.push({
            code: 'UNRESOLVED_AS_ABSENCE',
            message: 'Cannot declare absence for unresolved or conflict state',
            factRef: op.factRef,
          })
        } else if ('items' in fact && fact.items.length > 0) {
          errors.push({
            code: 'INVALID_FACT_REF',
            message: 'Cannot declare absence when items exist',
            factRef: op.factRef,
          })
        }
      } else if (
        ('status' in fact && (fact.status === 'unresolved' || fact.status === 'conflict')) ||
        ('determination' in fact && fact.determination === 'unresolved')
      ) {
        errors.push({
          code: 'UNRESOLVED_AS_ABSENCE',
          message: 'Cannot declare absence for unresolved or conflict state',
          factRef: op.factRef,
        })
      }
    }
  }

  for (const abs of output.abstentions) {
    if (abs.factRef) {
      const resolution = resolveFactRef(abs.factRef, contract)
      if (resolution.result === 'none') {
        errors.push({
          code: 'INVALID_FACT_REF',
          message: `Fact reference not found in contract: ${JSON.stringify(abs.factRef)}`,
          factRef: abs.factRef,
        })
      } else if (resolution.result === 'ambiguous') {
        errors.push({
          code: 'AMBIGUOUS_FACT_REF',
          message: `Fact reference matched ${resolution.matchCount} facts in scope ${abs.factRef.scope}: ${JSON.stringify(abs.factRef)}`,
          factRef: abs.factRef,
        })
      } else {
        const fact = resolution.fact
        if (
          abs.cause === 'missing_label' &&
          'semanticCompleteness' in fact &&
          fact.semanticCompleteness === 'complete'
        ) {
          errors.push({
            code: 'INVALID_ABSTENTION',
            message: 'Cannot abstain for missing_label when completeness is complete',
            factRef: abs.factRef,
          })
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}
