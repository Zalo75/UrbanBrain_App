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
import type { StructuredFactualOutput, StructuredFactRef, StructuredOperation } from './structuredFactualOutput'

export type ValidationErrorCode =
  | 'INVALID_FACT_REF'
  | 'AMBIGUOUS_FACT_REF'
  | 'CODE_MISMATCH'
  | 'LABEL_HALLUCINATION'
  | 'LABEL_MISMATCH'
  | 'PERCENTAGE_MISMATCH'
  | 'COVERAGE_MISMATCH'
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
  operation?: StructuredOperation['operation']
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: string[]
}

import { resolveFactRef } from './resolveFactRef'

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
        operation: op.operation,
      })
      continue
    }
    if (resolution.result === 'ambiguous') {
      errors.push({
        code: 'AMBIGUOUS_FACT_REF',
        message: `Fact reference matched ${resolution.matchCount} facts in scope ${op.factRef.scope}: ${JSON.stringify(op.factRef)}`,
        factRef: op.factRef,
        operation: op.operation,
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
          operation: op.operation,
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
          operation: op.operation,
        })
      } else if (semanticCompleteness === 'complete') {
        const actualLabel = 'label' in fact ? fact.label : undefined
        if (actualLabel !== op.label) {
          errors.push({
            code: 'LABEL_MISMATCH',
            message: `Expected label ${actualLabel}, got ${op.label}`,
            factRef: op.factRef,
            operation: op.operation,
          })
        }
      }
    }

    if (op.operation === 'state_percentage') {
      if (!('parcelPercentage' in fact) || fact.parcelPercentage === undefined) {
        const representsAccreditedFullCoverage =
          'coverage' in fact && fact.coverage === 'full' && op.percentage === 100
        if (!representsAccreditedFullCoverage) {
          errors.push({
            code: 'PERCENTAGE_MISMATCH',
            message: 'Fact does not have a compatible percentage',
            factRef: op.factRef,
            operation: op.operation,
          })
        }
      } else {
        const diff = Math.abs(fact.parcelPercentage - op.percentage)
        if (diff > 0.01) {
          errors.push({
            code: 'PERCENTAGE_MISMATCH',
            message: `Expected percentage ${fact.parcelPercentage}, got ${op.percentage}`,
            factRef: op.factRef,
            operation: op.operation,
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
          operation: op.operation,
        })
      }
    }

    if (op.operation === 'state_coverage') {
      const actualCoverage = 'coverage' in fact ? fact.coverage : undefined
      if (actualCoverage !== op.coverage) {
        errors.push({
          code: 'COVERAGE_MISMATCH',
          message: `Expected territorial coverage ${actualCoverage}, got ${op.coverage}`,
          factRef: op.factRef,
          operation: op.operation,
        })
      }
    }

    if (op.operation === 'state_conflict') {
      const actualStatus = 'status' in fact ? fact.status : undefined
      if (actualStatus !== 'conflict') {
        errors.push({
          code: 'STATUS_MISMATCH',
          message: `Expected status conflict, got ${actualStatus}`,
          factRef: op.factRef,
          operation: op.operation,
        })
      }
    }

    if (op.operation === 'state_unresolved') {
      const actualStatus = 'status' in fact ? fact.status : undefined
      if (actualStatus !== 'unresolved') {
        errors.push({
          code: 'STATUS_MISMATCH',
          message: `Expected status unresolved, got ${actualStatus}`,
          factRef: op.factRef,
          operation: op.operation,
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
          operation: op.operation,
        })
      }
    }

    if (op.operation === 'state_geometric_dominance') {
      if (!('parcelPercentage' in fact) || fact.parcelPercentage === undefined) {
        errors.push({
          code: 'PERCENTAGE_MISMATCH',
          message: 'Fact does not have a percentage for dominance',
          factRef: op.factRef,
          operation: op.operation,
        })
      } else {
        if (fact.parcelPercentage <= 50) {
          errors.push({
            code: 'PERCENTAGE_MISMATCH',
            message: 'Geometric dominance requires > 50%',
            factRef: op.factRef,
            operation: op.operation,
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
            operation: op.operation,
          })
        } else if ('items' in fact && fact.items.length > 0) {
          errors.push({
            code: 'INVALID_FACT_REF',
            message: 'Cannot declare absence when items exist',
            factRef: op.factRef,
            operation: op.operation,
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
          operation: op.operation,
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
