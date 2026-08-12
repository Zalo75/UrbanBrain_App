import type { TerritorialFactualContract } from '@/domain/parcel-context/factualContract'
import type { StructuredFactualOutput, StructuredOperation, StructuredAbstention, StructuredFactRef } from './structuredFactualOutput'

export type ValidationErrorCode =
  | 'INVALID_FACT_REF'
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

export function validateStructuredFactualOutput(output: StructuredFactualOutput, contract: TerritorialFactualContract): ValidationResult {
  const errors: ValidationError[] = []
  const warnings: string[] = []

  function resolveFactRef(ref: StructuredFactRef): any | null {
    switch (ref.type) {
      case 'classification':
        return contract.classification;
      case 'category':
        return contract.categories.find(c => c.code === ref.code) || null;
      case 'category_candidate': {
        const cat = contract.categories.find(c => c.code === ref.categoryCode);
        return cat?.candidates?.find(c => c.code === ref.candidateCode) || null;
      }
      case 'consolidation':
        return contract.consolidation;
      case 'planning_area':
        return contract.planningAreas.find(p => p.code === ref.code) || null;
      case 'affect':
        return contract.affects.items.find(a => a.label === ref.label) || null;
      case 'affects_state':
        return contract.affects;
      case 'scope':
        return ref.scopeType === 'parcel' ? contract.scopes.parcel : contract.scopes.actionArea;
      default:
        return null;
    }
  }

  for (const op of output.operations) {
    const fact = resolveFactRef(op.factRef)
    
    if (!fact) {
      if (op.operation === 'state_absence') {
        if (['category', 'category_candidate', 'planning_area', 'affect'].includes(op.factRef.type)) {
          continue;
        }
      }
      errors.push({ code: 'INVALID_FACT_REF', message: `Fact reference not found in contract: ${JSON.stringify(op.factRef)}`, factRef: op.factRef })
      continue
    }

    if (op.operation === 'reference_code') {
      if (fact.code !== op.code) {
        errors.push({ code: 'CODE_MISMATCH', message: `Expected code ${fact.code}, got ${op.code}`, factRef: op.factRef })
      }
    }

    if (op.operation === 'state_label') {
      if (fact.semanticCompleteness === 'partial' || fact.semanticCompleteness === undefined) {
        errors.push({ code: 'LABEL_HALLUCINATION', message: 'Cannot state label for a fact with partial completeness', factRef: op.factRef })
      } else if (fact.semanticCompleteness === 'complete') {
        if (fact.label !== op.label) {
          errors.push({ code: 'LABEL_MISMATCH', message: `Expected label ${fact.label}, got ${op.label}`, factRef: op.factRef })
        }
      }
    }

    if (op.operation === 'state_percentage') {
      if (fact.parcelPercentage === undefined) {
        errors.push({ code: 'PERCENTAGE_MISMATCH', message: 'Fact does not have a percentage', factRef: op.factRef })
      } else {
        const diff = Math.abs(fact.parcelPercentage - op.percentage)
        if (diff > 0.01) {
          errors.push({ code: 'PERCENTAGE_MISMATCH', message: `Expected percentage ${fact.parcelPercentage}, got ${op.percentage}`, factRef: op.factRef })
        }
      }
    }

    if (op.operation === 'state_status') {
      if (fact.status !== op.status) {
         errors.push({ code: 'STATUS_MISMATCH', message: `Expected status ${fact.status}, got ${op.status}`, factRef: op.factRef })
      }
    }

    if (op.operation === 'state_determination') {
      if (fact.determination !== op.determination) {
        errors.push({ code: 'DETERMINATION_MISMATCH', message: `Expected determination ${fact.determination}, got ${op.determination}`, factRef: op.factRef })
      }
    }
    
    if (op.operation === 'state_geometric_dominance') {
      if (fact.parcelPercentage === undefined) {
         errors.push({ code: 'PERCENTAGE_MISMATCH', message: 'Fact does not have a percentage for dominance', factRef: op.factRef })
      } else {
         if (fact.parcelPercentage <= 50) {
            errors.push({ code: 'PERCENTAGE_MISMATCH', message: 'Geometric dominance requires > 50%', factRef: op.factRef })
         }
      }
    }

    if (op.operation === 'state_absence') {
       if (op.factRef.type === 'affects_state') {
          if (fact.status === 'unresolved' || fact.status === 'conflict') {
             errors.push({ code: 'UNRESOLVED_AS_ABSENCE', message: 'Cannot declare absence for unresolved or conflict state', factRef: op.factRef })
          } else if (fact.items && fact.items.length > 0) {
             errors.push({ code: 'INVALID_FACT_REF', message: 'Cannot declare absence when items exist', factRef: op.factRef })
          }
       } else if (fact.status === 'unresolved' || fact.status === 'conflict' || fact.determination === 'unresolved') {
          errors.push({ code: 'UNRESOLVED_AS_ABSENCE', message: 'Cannot declare absence for unresolved or conflict state', factRef: op.factRef })
       }
    }
  }

  for (const abs of output.abstentions) {
    if (abs.factRef) {
      const fact = resolveFactRef(abs.factRef)
      if (fact) {
        if (abs.cause === 'missing_label' && fact.semanticCompleteness === 'complete') {
          errors.push({ code: 'INVALID_ABSTENTION', message: 'Cannot abstain for missing_label when completeness is complete', factRef: abs.factRef })
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  }
}
